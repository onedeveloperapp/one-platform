import PageSkeleton from "@/components/product/page-skeleton";

/** The decisions that wait for a person, each a card. */
export default function Loading() {
  return <PageSkeleton shape="list" rows={3} cards />;
}
