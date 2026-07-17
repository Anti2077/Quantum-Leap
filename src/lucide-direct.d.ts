declare module "lucide-react/dist/esm/icons/*.js" {
  import type { ForwardRefExoticComponent, RefAttributes, SVGProps } from "react";

  type DirectIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & {
    size?: string | number;
    absoluteStrokeWidth?: boolean;
  };

  const Icon: ForwardRefExoticComponent<DirectIconProps & RefAttributes<SVGSVGElement>>;
  export default Icon;
}
