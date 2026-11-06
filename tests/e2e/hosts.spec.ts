// 호스트 추가, 수정, 삭제, 검색. 데스크톱과 모바일 양쪽.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  acceptFirstKey,
  addHost,
  createVault,
  fillHostForm,
  hostMenu,
  hostRow,
  openHost,
  unlock,
} from "./support/app";
import { DummySsh, publicKeyBlob } from "./support/dummy-ssh";
import { PRIVATE_KEY, PUBLIC_KEY, SSH_PASSWORD } from "./support/secrets";

const LAYOUTS = [
  { label: "데스크톱", viewport: { width: 1280, height: 800 } },
  { label: "모바일", viewport: { width: 390, height: 844 } },
];

for (const { label, viewport } of LAYOUTS) {
  test.describe(label, () => {
    test.use({ viewport });

    test("빈 목록에 호스트 추가가 보이고, 추가한 호스트가 목록에 나오며 다시 열어도 남는다", async ({ page }) => {
      await createVault(page);
      await expect(page.getByText("저장된 호스트가 없습니다.")).toBeVisible();
      await expect(page.getByRole("searchbox")).toHaveCount(0);

      await addHost(page, { name: "alpha", hostname: "alpha.example", port: 2200, username: "ann", password: SSH_PASSWORD });
      await expect(hostRow(page, "alpha")).toContainText("ann@alpha.example:2200 · 비밀번호");
      await expect(page.getByText("저장된 호스트가 없습니다.")).toHaveCount(0);

      await page.reload();
      await unlock(page);
      await expect(hostRow(page, "alpha")).toContainText("ann@alpha.example:2200 · 비밀번호");
    });

    test("포트 기본값은 22, 이름을 비우면 주소를 쓰고, 인증 방식이 표시된다", async ({ page }) => {
      await createVault(page);
      await addHost(page, { hostname: "noname.example", username: "ann", password: "" });
      await expect(hostRow(page, "noname.example")).toContainText("ann@noname.example:22 · 비밀번호");

      await addHost(page, { name: "keyed", hostname: "k.example", username: "ann", key: { privateKey: PRIVATE_KEY } });
      await expect(hostRow(page, "keyed")).toContainText("개인키");

      await addHost(page, { name: "asked", hostname: "i.example", username: "ann", interactive: true });
      await expect(hostRow(page, "asked")).toContainText("대화형");
    });

    test("필수 칸이 비었거나 포트가 범위 밖이면 저장되지 않는다", async ({ page }) => {
      await createVault(page);
      await page.getByRole("button", { name: "호스트 추가" }).first().click();
      const dialog = page.getByRole("dialog", { name: "호스트 추가" });

      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog.getByText("호스트를 입력하세요.")).toBeVisible();
      await expect(dialog.getByText("사용자를 입력하세요.")).toBeVisible();

      for (const port of ["0", "65536", "abc", "22.5"]) {
        await fillHostForm(dialog, { hostname: "bad.example", username: "ann" });
        await dialog.getByLabel("포트", { exact: true }).fill(port);
        await dialog.getByRole("button", { name: "저장" }).click();
        await expect(dialog.getByText("포트는 1에서 65535 사이입니다.")).toBeVisible();
      }

      await dialog.getByRole("tab", { name: "개인키" }).click();
      await dialog.getByLabel("포트", { exact: true }).fill("22");
      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog.getByText("개인키를 붙여넣거나 파일을 고르세요.")).toBeVisible();

      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(page.getByText("저장된 호스트가 없습니다.")).toBeVisible();
    });

    test("수정은 저장 뒤 다시 열어도 남고, 취소하면 바뀌지 않는다", async ({ page }) => {
      await createVault(page);
      await addHost(page, { name: "before", hostname: "b.example", port: 22, username: "ann", password: SSH_PASSWORD });

      await hostMenu(page, "before", "수정");
      let dialog = page.getByRole("dialog", { name: "호스트 수정" });
      await expect(dialog.getByLabel("이름", { exact: true })).toHaveValue("before");
      await expect(dialog.getByLabel("호스트", { exact: true })).toHaveValue("b.example");
      await expect(dialog.getByLabel("포트", { exact: true })).toHaveValue("22");
      await expect(dialog.getByLabel("사용자", { exact: true })).toHaveValue("ann");
      await fillHostForm(dialog, { name: "discarded" });
      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(hostRow(page, "before")).toBeVisible();
      await expect(page.getByText("discarded")).toHaveCount(0);

      await hostMenu(page, "before", "수정");
      dialog = page.getByRole("dialog", { name: "호스트 수정" });
      await fillHostForm(dialog, { name: "after", hostname: "a.example", port: 2022, username: "bob" });
      await dialog.getByRole("button", { name: "저장" }).click();
      await expect(dialog).toBeHidden();
      await expect(hostRow(page, "after")).toContainText("bob@a.example:2022 · 비밀번호");
      await expect(page.getByText("before")).toHaveCount(0);

      await page.reload();
      await unlock(page);
      await expect(hostRow(page, "after")).toContainText("bob@a.example:2022 · 비밀번호");
      await expect(page.getByText("before")).toHaveCount(0);
    });

    test("삭제는 취소하면 남고, 확인하면 다시 열어도 없다. 마지막을 지우면 빈 목록이다", async ({ page }) => {
      await createVault(page);
      await addHost(page, { name: "one", hostname: "1.example", username: "ann" });
      await addHost(page, { name: "two", hostname: "2.example", username: "ann" });

      await hostMenu(page, "one", "삭제");
      let dialog = page.getByRole("dialog", { name: "호스트 삭제" });
      await expect(dialog).toContainText("one");
      await dialog.getByRole("button", { name: "취소" }).click();
      await expect(hostRow(page, "one")).toBeVisible();

      await hostMenu(page, "one", "삭제");
      dialog = page.getByRole("dialog", { name: "호스트 삭제" });
      await dialog.getByRole("button", { name: "삭제" }).click();
      await expect(hostRow(page, "one")).toHaveCount(0);
      await expect(hostRow(page, "two")).toBeVisible();

      await page.reload();
      await unlock(page);
      await expect(hostRow(page, "one")).toHaveCount(0);
      await expect(hostRow(page, "two")).toBeVisible();

      await hostMenu(page, "two", "삭제");
      await page.getByRole("dialog", { name: "호스트 삭제" }).getByRole("button", { name: "삭제" }).click();
      await expect(page.getByText("저장된 호스트가 없습니다.")).toBeVisible();
    });

    test("검색은 이름, 주소, 사용자로 찾고 대소문자를 가리지 않으며, 없으면 없다고 하고, 비우면 돌아온다", async ({ page }) => {
      await createVault(page);
      await addHost(page, { name: "Web-Prod", hostname: "web.example", username: "deploy" });
      await addHost(page, { name: "db", hostname: "postgres.internal", username: "admin" });
      const search = page.getByRole("searchbox", { name: "호스트 검색" });
      const expectOnly = async (visible: string, hidden: string) => {
        await expect(hostRow(page, visible)).toBeVisible();
        await expect(hostRow(page, hidden)).toHaveCount(0);
      };

      await search.fill("web-prod");
      await expectOnly("Web-Prod", "postgres.internal");
      await search.fill("POSTGRES");
      await expectOnly("postgres.internal", "Web-Prod");
      await search.fill("deploy");
      await expectOnly("Web-Prod", "postgres.internal");

      await search.fill("no-such-host");
      await expect(page.getByText("검색 결과가 없습니다.")).toBeVisible();
      await expect(page.locator("aside li")).toHaveCount(0);

      await search.fill("");
      await expect(page.locator("aside li")).toHaveCount(2);
    });
  });
}

test("수정으로 이름만 바꾸면 저장된 비밀번호가 유지된다", async ({ page }) => {
  const dummy = await new DummySsh().start();
  try {
    await createVault(page);
    await addHost(page, {
      name: "keeps-secret",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "ann",
      password: SSH_PASSWORD,
    });
    await hostMenu(page, "keeps-secret", "수정");
    const dialog = page.getByRole("dialog", { name: "호스트 수정" });
    await fillHostForm(dialog, { name: "renamed" });
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(dialog).toBeHidden();

    await openHost(page, "renamed");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.authAttempts.length).toBe(1);
    expect(dummy.authAttempts[0].password === SSH_PASSWORD).toBe(true);
    expect(dummy.authAttempts[0].username).toBe("ann");
  } finally {
    await dummy.stop();
  }
});

test("삭제하면 그 호스트의 열린 세션이 끊긴다", async ({ page }) => {
  const dummy = await new DummySsh().start();
  try {
    await createVault(page);
    await addHost(page, { name: "doomed", hostname: "127.0.0.1", port: dummy.port, username: "ann", password: SSH_PASSWORD });
    await openHost(page, "doomed");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.open).toBe(1);

    await hostMenu(page, "doomed", "삭제");
    await page.getByRole("dialog", { name: "호스트 삭제" }).getByRole("button", { name: "삭제" }).click();
    await expect.poll(() => dummy.open).toBe(0);
    await expect(page.getByRole("tab")).toHaveCount(0);
  } finally {
    await dummy.stop();
  }
});

test("개인키를 파일로 넣어도 저장되고 그 키로 인증을 시도한다", async ({ page }, testInfo) => {
  const dummy = await new DummySsh().start();
  try {
    mkdirSync(testInfo.outputDir, { recursive: true });
    const keyFile = join(testInfo.outputDir, "fake-key");
    writeFileSync(keyFile, PRIVATE_KEY);
    await createVault(page);
    await addHost(page, {
      name: "from-file",
      hostname: "127.0.0.1",
      port: dummy.port,
      username: "ann",
      key: { file: keyFile },
    });
    await expect(hostRow(page, "from-file")).toContainText("개인키");
    await openHost(page, "from-file");
    await acceptFirstKey(page);
    await expect.poll(() => dummy.authAttempts.length).toBeGreaterThan(0);
    expect(dummy.authAttempts[0].method).toBe("publickey");
    expect(dummy.authAttempts[0].publicKey === publicKeyBlob(PUBLIC_KEY)).toBe(true);
  } finally {
    await dummy.stop();
  }
});
