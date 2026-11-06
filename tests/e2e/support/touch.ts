// Real touch input through CDP (Input.dispatchTouchEvent), plus terminal cell geometry.
import type { CDPSession, Page } from "@playwright/test";
import type { DummySsh } from "./dummy-ssh";

export type Point = { x: number; y: number };

export class Finger {
  constructor(
    private cdp: CDPSession,
    private page: Page,
  ) {}

  static async on(page: Page) {
    return new Finger(await page.context().newCDPSession(page), page);
  }

  at: Point | null = null;

  async down(point: Point) {
    this.at = point;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  }

  async move(point: Point) {
    this.at = point;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point] });
  }

  /** Moves in small steps, as a finger does. */
  async glide(to: Point, steps = 8, stepMs = 15) {
    const from = this.at!;
    for (let i = 1; i <= steps; i++) {
      await this.move({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
      if (stepMs) await this.page.waitForTimeout(stepMs);
    }
  }

  async up() {
    this.at = null;
    await this.cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  }

  async hold(point: Point, ms = 700) {
    await this.down(point);
    await this.page.waitForTimeout(ms);
  }

  async detach() {
    await this.cdp.detach().catch(() => {});
  }
}

/** Center of a character cell of the visible terminal screen. */
export async function cell(page: Page, dummy: DummySsh, row: number, col: number): Promise<Point> {
  const box = (await page.locator(".xterm-screen").boundingBox())!;
  const { cols, rows } = dummy.size!;
  return { x: box.x + (box.width / cols) * (col + 0.5), y: box.y + (box.height / rows) * (row + 0.5) };
}

export const selectionCells = (page: Page) => page.locator(".xterm-selection div");
export const readClipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());
