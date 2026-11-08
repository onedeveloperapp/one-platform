import PageSkeleton from "@/components/product/page-skeleton";

/** The agency's passengers: their counts, the bar and the rows. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={8} />;
}
