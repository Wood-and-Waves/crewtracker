import type { Metadata } from "next";
import "./globals.css";
import ThemeScript from "@/components/ThemeScript";

export const metadata: Metadata = {
  title: "CrewTracker",
  description: "Crew time tracking and payroll for corporate AV shows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
