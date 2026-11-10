import PageSkeleton from "@/components/product/page-skeleton";

/** The firm's numbers: four of them, and the groups. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={6} />;
}
