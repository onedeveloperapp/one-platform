import PageSkeleton from "@/components/product/page-skeleton";

/** The filing queue: its four cards, its bar and its groups. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={3} cards />;
}
