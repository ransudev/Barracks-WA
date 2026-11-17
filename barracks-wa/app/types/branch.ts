export type Branch = {
  id: number;
  name: string;
  code: string;
  address: string;
  phone: string;
  // Tax identification number printed on receipts.
  tin?: string;
  status: "active" | "inactive";
  createdAt: string;
  updatedAt: string;
};

export type BranchStaff = {
  id: number;
  firstName: string;
  lastName: string;
  role: "manager" | "front_desk";
};

export type BranchAssignment = {
  userId: number;
  branchId: number;
  isPrimary: boolean;
  createdAt: string;
  updatedAt: string;
  staff: BranchStaff;
};

export type BranchContext = { branches: Branch[]; primaryBranch: Branch | null };

export type CustomerBranch = Pick<Branch, "id" | "name" | "code" | "address" | "phone">;
