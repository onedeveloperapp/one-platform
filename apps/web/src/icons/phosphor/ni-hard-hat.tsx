import { NextureIconsProps, sizeHelper } from "../nexture-icons";

import { HardHat } from "@phosphor-icons/react/dist/ssr";

export default function NiHardHat({ className, variant = "outlined", size = "medium" }: NextureIconsProps) {
  return (
    <HardHat className={className} size={sizeHelper(size)} weight={variant === "contained" ? "fill" : "regular"} />
  );
}
