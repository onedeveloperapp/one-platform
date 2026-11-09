import PageSkeleton from "@/components/product/page-skeleton";

/** The numbers of the month, then a card per family of ONE's work. */
export default function Loading() {
  return <PageSkeleton shape="cards" numbers={3} />;
}
