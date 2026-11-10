import PageSkeleton from "@/components/product/page-skeleton";

/** The people: their four numbers, and the rows of the list. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={8} />;
}
