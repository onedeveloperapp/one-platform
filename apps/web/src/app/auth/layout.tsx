import { Suspense } from "react";

import Loading from "@/components/layout/containers/loading-screen";

/** Every auth screen is a `min-h-screen` box that centres its own card. */
export default async function AuthLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}
