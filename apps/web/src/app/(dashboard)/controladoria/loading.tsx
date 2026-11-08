import PageSkeleton from "@/components/product/page-skeleton";

/** The numbers of the stock, then the list they open. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={6} />;
}
