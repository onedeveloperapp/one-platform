import PageSkeleton from "@/components/product/page-skeleton";

/** The list of cases: its four cards of numbers, its bar and its rows. */
export default function Loading() {
  return <PageSkeleton shape="list" numbers={4} rows={8} />;
}
