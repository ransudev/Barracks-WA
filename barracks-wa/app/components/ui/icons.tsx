import type { SVGProps } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Banknote,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Coffee,
  ContactRound,
  CreditCard,
  Dot,
  Download,
  Droplet,
  Ellipsis,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Hand,
  House,
  Image,
  Info,
  ListFilter,
  ListOrdered,
  Lock,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Moon,
  Package,
  PackagePlus,
  Palette,
  Pencil,
  Phone,
  Plus,
  RefreshCw,
  Scissors,
  Search,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Star,
  Sun,
  Trash2,
  UserPlus,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";

export type IconName =
  | "home"
  | "queue"
  | "calendar"
  | "users"
  | "wallet"
  | "box"
  | "settings"
  | "chart"
  | "report"
  | "frontDesk"
  | "briefcase"
  | "scissors"
  | "coffee"
  | "comb"
  | "razor"
  | "droplet"
  | "palette"
  | "hand"
  | "shoppingBag"
  | "search"
  | "bell"
  | "plus"
  | "arrowRight"
  | "chevronDown"
  | "chevronRight"
  | "chevronLeft"
  | "check"
  | "clock"
  | "more"
  | "stockIn"
  | "logOut"
  | "spark"
  | "sun"
  | "moon"
  | "lock"
  | "mail"
  | "phone"
  | "mapPin"
  | "download"
  | "filter"
  | "edit"
  | "refresh"
  | "userPlus"
  | "sliders"
  | "external"
  | "star"
  | "info"
  | "x"
  | "trash"
  | "creditCard"
  | "cash"
  | "mobile"
  | "eye"
  | "eyeOff"
  | "menu"
  | "checkCircle"
  | "dot"
  | "arrowUp"
  | "arrowDown"
  | "photo";

const icons: Record<IconName, LucideIcon> = {
  home: House,
  queue: ListOrdered,
  calendar: CalendarDays,
  users: Users,
  wallet: Wallet,
  box: Package,
  settings: Settings,
  chart: ChartNoAxesColumnIncreasing,
  report: FileText,
  frontDesk: ContactRound,
  briefcase: BriefcaseBusiness,
  scissors: Scissors,
  coffee: Coffee,
  comb: Scissors,
  razor: Scissors,
  droplet: Droplet,
  palette: Palette,
  hand: Hand,
  shoppingBag: ShoppingBag,
  search: Search,
  bell: Bell,
  plus: Plus,
  arrowRight: ArrowRight,
  chevronDown: ChevronDown,
  chevronRight: ChevronRight,
  chevronLeft: ChevronLeft,
  check: Check,
  clock: Clock,
  more: Ellipsis,
  stockIn: PackagePlus,
  logOut: LogOut,
  spark: Sparkles,
  sun: Sun,
  moon: Moon,
  lock: Lock,
  mail: Mail,
  phone: Phone,
  mapPin: MapPin,
  download: Download,
  filter: ListFilter,
  edit: Pencil,
  refresh: RefreshCw,
  userPlus: UserPlus,
  sliders: SlidersHorizontal,
  external: ExternalLink,
  star: Star,
  info: Info,
  x: X,
  trash: Trash2,
  creditCard: CreditCard,
  cash: Banknote,
  mobile: Smartphone,
  eye: Eye,
  eyeOff: EyeOff,
  menu: Menu,
  checkCircle: CircleCheck,
  dot: Dot,
  arrowUp: ArrowUp,
  arrowDown: ArrowDown,
  photo: Image,
};

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: {
  name: IconName;
  size?: number;
  strokeWidth?: number;
} & SVGProps<SVGSVGElement>) {
  const LucideIconComponent = icons[name];

  return (
    <LucideIconComponent aria-hidden="true" size={size} strokeWidth={strokeWidth} {...props} />
  );
}
