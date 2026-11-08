import PageSkeleton from "@/components/product/page-skeleton";

/** The publications: their cards, the bar and each publication. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={2} cards />;
}
