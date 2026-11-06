import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { VaultProvider } from "@/components/app/vault-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "pswrsh",
  description: "웹 SSH 클라이언트",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#09090b",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`dark ${geistSans.variable} ${geistMono.variable} antialiased`}>
      <body className="font-sans">
        <VaultProvider>{children}</VaultProvider>
      </body>
    </html>
  );
}
