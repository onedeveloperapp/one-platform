import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { Umbrella } from "@phosphor-icons/react/dist/ssr";

export default function NiUmbrella({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <Umbrella className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
