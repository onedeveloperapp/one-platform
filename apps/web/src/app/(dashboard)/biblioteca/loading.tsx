import PageSkeleton from "@/components/product/page-skeleton";

/** The library: its three counts and its rows. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={3} rows={6} />;
}
