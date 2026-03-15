export interface Product {
  id: string;
  name: string;
  category: string;
  totalStock: number;
  unit: string;
  unitPrice: number;
}

export interface StaffProductHolding {
  productId: string;
  productName: string;
  qtyHeld: number;
  serialNumbers: string[];
}

export interface Staff {
  id: string;
  name: string;
  designation: string;
  mobile: string;
  holdings: StaffProductHolding[];
}

export type TransactionType = 'ISSUE' | 'RETURN';
export type PaymentType = 'Cash' | 'Credit';

export interface Transaction {
  id: string;
  poNumber: string;
  staffId: string;
  staffName: string;
  productId: string;
  productName: string;
  productHead?: string;
  quantity: number;
  amount: number;
  paymentType: PaymentType;
  type: TransactionType;
  serialNumbers: string[];
  timestamp: string;
  remarks?: string;
}

export interface Counter {
  id: string;
  lastValue: number;
  year: number;
}
