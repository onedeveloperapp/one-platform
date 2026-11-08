import PageSkeleton from "@/components/product/page-skeleton";

/** The hearings: their four lists, and the rows of one. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={6} />;
}
