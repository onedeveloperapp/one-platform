import PageSkeleton from "@/components/product/page-skeleton";

/** The clients' parts: their four numbers, and the list. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={6} />;
}
