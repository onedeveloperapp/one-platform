import PageSkeleton from "@/components/product/page-skeleton";

/** Any page of the logged area with no loading of its own: a few cards under its title. */
export default function Loading() {
  return <PageSkeleton shape="cards" />;
}
