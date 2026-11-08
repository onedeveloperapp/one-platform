import PageSkeleton from "@/components/product/page-skeleton";

/** The deadlines: their five lists, and the rows of one. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={5} rows={6} />;
}
