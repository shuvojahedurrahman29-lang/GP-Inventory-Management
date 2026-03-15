import React, { useState, useEffect, useMemo } from 'react';
import { 
  LayoutGrid, 
  Users, 
  FileText, 
  Settings as SettingsIcon, 
  Plus, 
  X, 
  Search, 
  ArrowRightLeft, 
  Download, 
  Edit2, 
  Trash2,
  LogOut,
  ChevronRight,
  Package,
  AlertCircle,
  CheckCircle2,
  Calendar,
  User as UserIcon,
  Camera,
  Upload
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where, 
  orderBy,
  getDoc,
  setDoc,
  runTransaction,
  Timestamp
} from 'firebase/firestore';
import { 
  signInWithPopup, 
  GoogleAuthProvider, 
  onAuthStateChanged, 
  signOut,
  updateProfile,
  User
} from 'firebase/auth';
import { db, auth } from './firebase';
import { Product, Staff, Transaction, TransactionType, PaymentType } from './types';
import { generatePONumber } from './utils/poGenerator';
import { ErrorBoundary } from './components/ErrorBoundary';
import { format, isSameDay, parseISO, isWithinInterval, startOfDay, endOfDay } from 'date-fns';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// Firestore Error Handling
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: any;
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// --- Components ---

const Button = ({ 
  children, 
  onClick, 
  variant = 'primary', 
  className,
  disabled,
  type = 'button'
}: { 
  children: React.ReactNode; 
  onClick?: () => void; 
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  className?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
}) => {
  const variants = {
    primary: 'bg-[#E21F26] text-white hover:bg-red-700',
    secondary: 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50',
    danger: 'bg-red-50 text-red-600 hover:bg-red-100',
    ghost: 'bg-transparent text-gray-500 hover:bg-gray-100'
  };

  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'px-4 py-2 rounded-xl font-medium transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        className
      )}
    >
      {children}
    </button>
  );
};

const Modal = ({ 
  isOpen, 
  onClose, 
  title, 
  children 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  title: string; 
  children: React.ReactNode;
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-4 border-bottom flex items-center justify-between bg-gray-50">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500"
            id="modal-close-btn"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto">
          {children}
        </div>
      </motion.div>
    </div>
  );
};

const Card = ({ children, className, onClick }: { children: React.ReactNode; className?: string; onClick?: () => void; [key: string]: any }) => (
  <div 
    onClick={onClick}
    className={cn(
      "bg-white rounded-2xl p-6 shadow-sm border border-gray-100 transition-all hover:shadow-md",
      onClick && "cursor-pointer hover:border-[#E21F26]/30",
      className
    )}
  >
    {children}
  </div>
);

// --- Main App ---

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'inventory' | 'staff' | 'reports' | 'utilities'>('dashboard');
  
  // Data State
  const [products, setProducts] = useState<Product[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  
  // UI State
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [isTransactionModalOpen, setIsTransactionModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [selectedStaff, setSelectedStaff] = useState<Staff | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [transactionType, setTransactionType] = useState<TransactionType>('ISSUE');
  const [transactionQty, setTransactionQty] = useState(1);
  const [transactionAmount, setTransactionAmount] = useState(0);
  const [paymentType, setPaymentType] = useState<PaymentType>('Cash');
  const [productHead, setProductHead] = useState('');
  const [remarks, setRemarks] = useState('');
  const [serialInput, setSerialInput] = useState('');
  const [serials, setSerials] = useState<string[]>([]);
  const [viewingStaffDetails, setViewingStaffDetails] = useState<Staff | null>(null);
  const [userProfile, setUserProfile] = useState<{ photoURL: string } | null>(null);
  const [isUploadingProfile, setIsUploadingProfile] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{ type: string, id: string, name: string } | null>(null);
  const [reportStartDate, setReportStartDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [reportEndDate, setReportEndDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState(user?.displayName || '');

  useEffect(() => {
    if (user) {
      setNewName(user.displayName || '');
    }
  }, [user]);

  const isAdmin = user?.email === 'shuvojahedurrahman29@gmail.com';

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  // Real-time Listeners
  useEffect(() => {
    if (!user) return;

    const unsubProducts = onSnapshot(collection(db, 'products'), 
      (snapshot) => {
        setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );

    const unsubStaff = onSnapshot(collection(db, 'staff'), 
      (snapshot) => {
        setStaff(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Staff)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'staff')
    );

    const unsubTransactions = onSnapshot(
      query(collection(db, 'transactions'), orderBy('timestamp', 'desc')), 
      (snapshot) => {
        setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Transaction)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'transactions')
    );

    const unsubProfile = onSnapshot(doc(db, 'userProfiles', user.uid), 
      (snapshot) => {
        if (snapshot.exists()) {
          setUserProfile(snapshot.data() as { photoURL: string });
        } else {
          setUserProfile(null);
        }
      },
      (err) => handleFirestoreError(err, OperationType.GET, `userProfiles/${user.uid}`)
    );

    return () => {
      unsubProducts();
      unsubStaff();
      unsubTransactions();
      unsubProfile();
    };
  }, [user]);

  // Sync quantity with serials count
  useEffect(() => {
    if (serials.length > 0) {
      setTransactionQty(serials.length);
    }
  }, [serials.length]);

  // Auto-calculate amount
  useEffect(() => {
    if (selectedProduct && transactionQty > 0) {
      setTransactionAmount((selectedProduct.unitPrice || 0) * transactionQty);
    }
  }, [selectedProduct, transactionQty]);

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (error) {
      console.error('Login failed', error);
    }
  };

  const handleLogout = () => signOut(auth);

  // --- Logic Functions ---

  const saveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const data = {
      name: formData.get('name') as string,
      category: formData.get('category') as string,
      totalStock: Number(formData.get('totalStock')),
      unit: formData.get('unit') as string,
      unitPrice: Number(formData.get('unitPrice')),
    };

    try {
      if (editingProduct) {
        await updateDoc(doc(db, 'products', editingProduct.id), data);
      } else {
        await addDoc(collection(db, 'products'), data);
      }
      setIsProductModalOpen(false);
      setEditingProduct(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'products');
    }
  };

  const saveStaff = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const mobile = formData.get('mobile') as string;
    
    if (mobile.length !== 11 || !/^\d+$/.test(mobile)) {
      alert('Mobile number must be exactly 11 digits.');
      return;
    }

    const data = {
      name: formData.get('name') as string,
      designation: formData.get('designation') as string,
      mobile: mobile,
      holdings: editingStaff ? editingStaff.holdings : [],
    };

    try {
      if (editingStaff) {
        await updateDoc(doc(db, 'staff', editingStaff.id), data);
      } else {
        await addDoc(collection(db, 'staff'), data);
      }
      setIsStaffModalOpen(false);
      setEditingStaff(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'staff');
    }
  };

  const deleteRecord = async () => {
    if (!deleteConfirmation) return;
    
    const { type, id } = deleteConfirmation;
    try {
      await deleteDoc(doc(db, type, id));
      setDeleteConfirmation(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, type);
    }
  };

  const exportToExcel = () => {
    const data = filteredTransactions.map(t => ({
      'PO Number': t.poNumber,
      'Staff Name': t.staffName,
      'Product': t.productName,
      'Quantity': t.quantity,
      'Type': t.type,
      'Serial Numbers': t.serialNumbers.join(', '),
      'Date': format(parseISO(t.timestamp), 'dd MMM yyyy hh:mm a'),
      'Amount': t.amount || 0,
      'Payment Type': t.paymentType || 'N/A',
      'Remarks': t.remarks || ''
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Transactions");
    
    // Generate filename with date range
    const fileName = `Transactions_${reportStartDate}_to_${reportEndDate}.xlsx`;
    XLSX.writeFile(workbook, fileName);
  };

  const processTransaction = async () => {
    if (!selectedStaff || !selectedProduct) {
      alert('Please select staff and product.');
      return;
    }

    if (transactionQty <= 0) {
      alert('Quantity must be greater than zero.');
      return;
    }

    if (transactionType === 'ISSUE' && selectedProduct.totalStock < transactionQty) {
      alert('Insufficient Stock in master inventory.');
      return;
    }

    // Check staff holdings for returns
    const staffHolding = selectedStaff.holdings?.find(h => h.productId === selectedProduct.id);
    if (transactionType === 'RETURN' && (!staffHolding || staffHolding.qtyHeld < transactionQty)) {
      alert('Staff does not hold enough quantity to return.');
      return;
    }

    try {
      const poNumber = await generatePONumber();
      const timestamp = new Date().toISOString();

      await runTransaction(db, async (transaction) => {
        const productRef = doc(db, 'products', selectedProduct.id);
        const staffRef = doc(db, 'staff', selectedStaff.id);
        
        const prodDoc = await transaction.get(productRef);
        const staffDoc = await transaction.get(staffRef);

        if (!prodDoc.exists() || !staffDoc.exists()) throw new Error('Document not found');

        const currentProdStock = prodDoc.data().totalStock;
        const currentStaffHoldings = staffDoc.data().holdings || [];

        let newProdStock = currentProdStock;
        let newStaffHoldings = [...currentStaffHoldings];

        const holdingIndex = newStaffHoldings.findIndex(h => h.productId === selectedProduct.id);

        if (transactionType === 'ISSUE') {
          newProdStock -= transactionQty;
          if (holdingIndex > -1) {
            newStaffHoldings[holdingIndex] = {
              ...newStaffHoldings[holdingIndex],
              qtyHeld: newStaffHoldings[holdingIndex].qtyHeld + transactionQty,
              serialNumbers: [...newStaffHoldings[holdingIndex].serialNumbers, ...serials]
            };
          } else {
            newStaffHoldings.push({
              productId: selectedProduct.id,
              productName: selectedProduct.name,
              qtyHeld: transactionQty,
              serialNumbers: serials
            });
          }
        } else {
          newProdStock += transactionQty;
          if (holdingIndex > -1) {
            const updatedQty = newStaffHoldings[holdingIndex].qtyHeld - transactionQty;
            const updatedSerials = newStaffHoldings[holdingIndex].serialNumbers.filter(s => !serials.includes(s));
            
            if (updatedQty <= 0) {
              // Zero-Stock Wipe
              newStaffHoldings.splice(holdingIndex, 1);
            } else {
              newStaffHoldings[holdingIndex] = {
                ...newStaffHoldings[holdingIndex],
                qtyHeld: updatedQty,
                serialNumbers: updatedSerials
              };
            }
          }
        }

        transaction.update(productRef, { totalStock: newProdStock });
        transaction.update(staffRef, { holdings: newStaffHoldings });
        
        const transRef = doc(collection(db, 'transactions'));
        transaction.set(transRef, {
          poNumber,
          staffId: selectedStaff.id,
          staffName: selectedStaff.name,
          productId: selectedProduct.id,
          productName: selectedProduct.name,
          productHead: productHead || selectedProduct.category,
          quantity: transactionQty,
          amount: transactionAmount,
          paymentType: paymentType,
          type: transactionType,
          serialNumbers: serials,
          timestamp,
          remarks: remarks || (serials.length > 0 ? `Serials: ${serials.join(', ')}` : '')
        });
      });

      generateReceiptPDF(
        poNumber, 
        selectedStaff, 
        selectedProduct, 
        serials, 
        transactionQty, 
        transactionAmount,
        paymentType,
        productHead || selectedProduct.category,
        transactionType, 
        timestamp,
        remarks
      );
      setIsTransactionModalOpen(false);
      resetTransactionForm();
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'transactions');
    }
  };

  const resetTransactionForm = () => {
    setSelectedStaff(null);
    setSelectedProduct(null);
    setSerials([]);
    setSerialInput('');
    setTransactionQty(1);
    setTransactionAmount(0);
    setPaymentType('Cash');
    setProductHead('');
    setRemarks('');
  };

  const generateReceiptPDF = (
    po: string, 
    staff: Staff, 
    product: Product, 
    serials: string[], 
    qty: number,
    amount: number,
    paymentType: string,
    head: string,
    type: TransactionType,
    timestamp: string,
    remarks?: string
  ) => {
    const doc = new jsPDF() as any;
    const dateStr = format(parseISO(timestamp), 'dd MMM yyyy, hh:mm a');

    // Header
    doc.setFontSize(22);
    doc.setTextColor(226, 31, 38); // Crimson Red
    doc.text('M/S Suzun Enterprise', 105, 20, { align: 'center' });
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text('Authorized Distributor | GP Distribution Suite', 105, 28, { align: 'center' });

    doc.setDrawColor(226, 31, 38);
    doc.setLineWidth(0.5);
    doc.line(20, 35, 190, 35);

    // Info Section
    doc.setFontSize(11);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.text(`Receipt To:`, 20, 45);
    doc.setFont('helvetica', 'normal');
    doc.text(`${staff.name}`, 20, 51);
    doc.text(`${staff.designation}`, 20, 57);
    doc.text(`Mobile: ${staff.mobile}`, 20, 63);

    doc.setFont('helvetica', 'bold');
    doc.text(`Transaction Info:`, 140, 45);
    doc.setFont('helvetica', 'normal');
    doc.text(`PO: ${po}`, 140, 51);
    doc.text(`Date: ${dateStr}`, 140, 57);
    doc.text(`Type: ${type}`, 140, 63);

    // Table
    const tableData = [
      [
        head || product.category,
        product.name,
        qty.toString(),
        amount.toFixed(2),
        remarks || (serials.length > 0 ? `Serials: ${serials.join(', ')}` : 'N/A')
      ]
    ];

    autoTable(doc, {
      startY: 75,
      head: [['Product Head', 'Product', 'Qty', 'Amount', 'Remarks']],
      body: tableData,
      headStyles: { fillColor: [226, 31, 38], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [250, 250, 250] },
      margin: { top: 75 },
      styles: { fontSize: 9, cellPadding: 4 }
    });

    const finalY = (doc as any).lastAutoTable.finalY || 100;

    // Footer
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text(`Total Amount: BDT ${amount.toFixed(2)}`, 140, finalY + 15);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Payment Type: ${paymentType}`, 140, finalY + 22);

    doc.setFontSize(9);
    doc.setTextColor(150);
    doc.text('Thank you for your business!', 105, 280, { align: 'center' });
    doc.text('This is an automated system generated receipt.', 105, 285, { align: 'center' });

    doc.save(`${po}_Receipt.pdf`);
  };

  const handleUpdateName = async () => {
    if (!user || !newName.trim()) return;
    try {
      await updateProfile(user, { displayName: newName.trim() });
      setIsEditingName(false);
      // Force a small refresh of the user object if needed, 
      // but usually the local state 'newName' will suffice for immediate UI feedback
    } catch (err) {
      console.error("Error updating profile name:", err);
    }
  };

  const handleProfileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (file.size > 1024 * 1024) {
      alert('File size must be less than 1MB');
      return;
    }

    setIsUploadingProfile(true);
    const reader = new FileReader();
    reader.onloadend = async () => {
      const base64String = reader.result as string;
      try {
        await setDoc(doc(db, 'userProfiles', user.uid), {
          uid: user.uid,
          photoURL: base64String,
          updatedAt: new Date().toISOString()
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `userProfiles/${user.uid}`);
      } finally {
        setIsUploadingProfile(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const addSerial = () => {
    if (!serialInput.trim()) return;
    if (serials.includes(serialInput.trim())) {
      alert('Serial already added');
      return;
    }
    setSerials([...serials, serialInput.trim()]);
    setSerialInput('');
  };

  // --- Filtering ---
  const dailyTransactions = useMemo(() => {
    const today = new Date();
    return transactions.filter(t => isSameDay(parseISO(t.timestamp), today));
  }, [transactions]);

  const filteredTransactions = useMemo(() => {
    const start = startOfDay(parseISO(reportStartDate));
    const end = endOfDay(parseISO(reportEndDate));
    return transactions.filter(t => {
      const date = parseISO(t.timestamp);
      return isWithinInterval(date, { start, end });
    });
  }, [transactions, reportStartDate, reportEndDate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-[#E21F26] border-t-transparent rounded-full animate-spin"></div>
          <p className="text-gray-500 font-medium">Initializing Suite...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <Card className="max-w-md w-full text-center p-10">
          <div className="w-20 h-20 bg-red-50 rounded-3xl flex items-center justify-center mx-auto mb-6">
            <Package className="w-10 h-10 text-[#E21F26]" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Suzun Enterprise</h1>
          <p className="text-gray-500 mb-8">Distribution Suite Management System</p>
          <Button onClick={handleLogin} className="w-full py-4 text-lg">
            Sign in with Google
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div className="min-h-screen bg-[#F8F9FA] flex flex-col">
        {/* Header */}
        <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
          <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#E21F26] rounded-xl flex items-center justify-center shadow-lg shadow-red-200">
                <Package className="text-white w-6 h-6" />
              </div>
              <h1 className="font-bold text-xl text-gray-900 hidden sm:block">Suzun Enterprise</h1>
            </div>
            
            <div className="flex items-center gap-4">
              <div className="text-right hidden sm:block">
                <p className="text-sm font-bold text-gray-900">{user.displayName}</p>
                <p className="text-xs text-gray-500">{isAdmin ? 'IT Officer' : 'Staff'}</p>
              </div>
              
              <button 
                onClick={() => isAdmin && setActiveTab('utilities')}
                className={cn(
                  "w-10 h-10 rounded-full overflow-hidden border-2 transition-all flex items-center justify-center",
                  isAdmin ? "border-[#E21F26] cursor-pointer hover:scale-105 shadow-sm" : "border-gray-200 cursor-default"
                )}
                title={isAdmin ? "Admin Settings" : "Profile"}
              >
                {userProfile?.photoURL || user.photoURL ? (
                  <img 
                    src={userProfile?.photoURL || user.photoURL || ''} 
                    alt="Profile" 
                    className="w-full h-full object-cover"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-full h-full bg-gray-100 flex items-center justify-center text-gray-400">
                    <UserIcon size={20} />
                  </div>
                )}
              </button>

              <button 
                onClick={handleLogout}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors text-gray-500"
              >
                <LogOut size={20} />
              </button>
            </div>
          </div>
        </header>

        <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 lg:p-8">
          {/* Navigation Tabs */}
          <div className="flex gap-2 mb-8 overflow-x-auto pb-2 no-scrollbar">
            {[
              { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
              { id: 'inventory', label: 'Inventory', icon: Package },
              { id: 'staff', label: 'Staff', icon: Users },
              { id: 'reports', label: 'Reports', icon: FileText },
              { id: 'utilities', label: 'Utilities', icon: SettingsIcon },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={cn(
                  "flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all whitespace-nowrap",
                  activeTab === tab.id 
                    ? "bg-[#E21F26] text-white shadow-lg shadow-red-100" 
                    : "bg-white text-gray-500 hover:bg-gray-50 border border-gray-100"
                )}
              >
                <tab.icon size={18} />
                {tab.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
              >
                {/* Stats Cards */}
                <Card className="bg-gradient-to-br from-[#E21F26] to-red-700 text-white border-none">
                  <p className="text-red-100 text-sm font-medium mb-1">Total Products</p>
                  <h3 className="text-3xl font-bold">{products.length}</h3>
                  <div className="mt-4 flex items-center gap-2 text-red-100 text-xs">
                    <Package size={14} />
                    <span>In Master Stock</span>
                  </div>
                </Card>

                <Card>
                  <p className="text-gray-500 text-sm font-medium mb-1">Active Staff</p>
                  <h3 className="text-3xl font-bold text-gray-900">{staff.length}</h3>
                  <div className="mt-4 flex items-center gap-2 text-emerald-600 text-xs">
                    <Users size={14} />
                    <span>Verified Distribution</span>
                  </div>
                </Card>

                <Card>
                  <p className="text-gray-500 text-sm font-medium mb-1">Today's Transactions</p>
                  <h3 className="text-3xl font-bold text-gray-900">{dailyTransactions.length}</h3>
                  <div className="mt-4 flex items-center gap-2 text-blue-600 text-xs">
                    <ArrowRightLeft size={14} />
                    <span>Real-time Sync</span>
                  </div>
                </Card>

                <Card>
                  <p className="text-gray-500 text-sm font-medium mb-1">System Status</p>
                  <h3 className="text-3xl font-bold text-gray-900">Healthy</h3>
                  <div className="mt-4 flex items-center gap-2 text-emerald-600 text-xs">
                    <CheckCircle2 size={14} />
                    <span>100% Data Integrity</span>
                  </div>
                </Card>

                {/* Quick Actions */}
                <div className="col-span-1 sm:col-span-2 lg:col-span-4 mt-4">
                  <h2 className="text-lg font-bold text-gray-900 mb-4">Quick Actions</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <button 
                      onClick={() => { setTransactionType('ISSUE'); setIsTransactionModalOpen(true); }}
                      className="bg-white p-6 rounded-2xl border border-gray-100 flex flex-col items-center gap-3 hover:border-[#E21F26] transition-all group"
                    >
                      <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center text-[#E21F26] group-hover:bg-[#E21F26] group-hover:text-white transition-all">
                        <Plus size={24} />
                      </div>
                      <span className="font-bold text-gray-900">Issue Stock</span>
                    </button>
                    <button 
                      onClick={() => { setTransactionType('RETURN'); setIsTransactionModalOpen(true); }}
                      className="bg-white p-6 rounded-2xl border border-gray-100 flex flex-col items-center gap-3 hover:border-[#E21F26] transition-all group"
                    >
                      <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center text-blue-600 group-hover:bg-blue-600 group-hover:text-white transition-all">
                        <ArrowRightLeft size={24} />
                      </div>
                      <span className="font-bold text-gray-900">Return Stock</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('staff')}
                      className="bg-white p-6 rounded-2xl border border-gray-100 flex flex-col items-center gap-3 hover:border-[#E21F26] transition-all group"
                    >
                      <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white transition-all">
                        <Users size={24} />
                      </div>
                      <span className="font-bold text-gray-900">Manage Staff</span>
                    </button>
                    <button 
                      onClick={() => setActiveTab('reports')}
                      className="bg-white p-6 rounded-2xl border border-gray-100 flex flex-col items-center gap-3 hover:border-[#E21F26] transition-all group"
                    >
                      <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center text-amber-600 group-hover:bg-amber-600 group-hover:text-white transition-all">
                        <FileText size={24} />
                      </div>
                      <span className="font-bold text-gray-900">View Logs</span>
                    </button>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'inventory' && (
              <motion.div 
                key="inventory"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">Master Inventory</h2>
                  {isAdmin && (
                    <Button onClick={() => { setEditingProduct(null); setIsProductModalOpen(true); }}>
                      <Plus size={18} /> Add Product
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {products.map(product => (
                    <Card key={product.id} className="relative group">
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-12 h-12 bg-gray-50 rounded-xl flex items-center justify-center text-gray-400">
                          <Package size={24} />
                        </div>
                        {isAdmin && (
                          <div className="flex gap-2">
                            <button 
                              onClick={() => { setEditingProduct(product); setIsProductModalOpen(true); }}
                              className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600 transition-all"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmation({ type: 'products', id: product.id, name: product.name })}
                              className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                      <h4 className="font-bold text-lg text-gray-900 mb-1">{product.name}</h4>
                      <p className="text-sm text-gray-500 mb-1">{product.category}</p>
                      <p className="text-sm font-bold text-[#E21F26] mb-4">BDT {(product.unitPrice || 0).toFixed(2)} / {product.unit}</p>
                      <div className="flex items-end justify-between">
                        <div>
                          <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Stock Level</p>
                          <p className="text-2xl font-bold text-gray-900">
                            {product.totalStock} <span className="text-sm font-normal text-gray-400">{product.unit}</span>
                          </p>
                        </div>
                        <div className={cn(
                          "px-3 py-1 rounded-full text-xs font-bold",
                          product.totalStock > 10 ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"
                        )}>
                          {product.totalStock > 10 ? 'In Stock' : 'Low Stock'}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'staff' && (
              <motion.div 
                key="staff"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex items-center justify-between">
                  <h2 className="text-2xl font-bold text-gray-900">Staff Directory</h2>
                  {isAdmin && (
                    <Button onClick={() => { setEditingStaff(null); setIsStaffModalOpen(true); }}>
                      <Plus size={18} /> Add Staff
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {staff.map(member => (
                    <Card key={member.id} className="relative group cursor-pointer" onClick={() => setViewingStaffDetails(member)}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="w-12 h-12 bg-[#E21F26]/5 rounded-xl flex items-center justify-center text-[#E21F26]">
                          <Users size={24} />
                        </div>
                        {isAdmin && (
                          <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                            <button 
                              onClick={() => { setEditingStaff(member); setIsStaffModalOpen(true); }}
                              className="p-2 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-blue-600 transition-all"
                            >
                              <Edit2 size={16} />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmation({ type: 'staff', id: member.id, name: member.name })}
                              className="p-2 hover:bg-red-50 rounded-lg text-gray-400 hover:text-red-600 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        )}
                      </div>
                      <h4 className="font-bold text-lg text-gray-900 mb-1">{member.name}</h4>
                      <p className="text-sm text-gray-500 mb-1">{member.designation}</p>
                      <p className="text-sm font-medium text-[#E21F26] mb-4">{member.mobile}</p>
                      
                      <div className="pt-4 border-t border-gray-100 flex items-center justify-between">
                        <div>
                          <p className="text-xs text-gray-400 uppercase font-bold tracking-wider">Total Held</p>
                          <p className="text-xl font-bold text-gray-900">
                            {member.holdings?.reduce((acc, h) => acc + h.qtyHeld, 0) || 0}
                          </p>
                        </div>
                        <div className="flex flex-col items-end">
                          <p className="text-[10px] text-gray-400 uppercase font-bold tracking-wider">Status</p>
                          {member.holdings?.length > 0 ? (
                            <span className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                              <CheckCircle2 size={12} /> In Stock
                            </span>
                          ) : (
                            <span className="text-xs font-bold text-red-500 flex items-center gap-1">
                              <AlertCircle size={12} /> Out of Stock
                            </span>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              </motion.div>
            )}

            {activeTab === 'reports' && (
              <motion.div 
                key="reports"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="space-y-6"
              >
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <h2 className="text-2xl font-bold text-gray-900">Advanced Reporting</h2>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-gray-100 shadow-sm">
                      <span className="text-xs font-bold text-gray-400 uppercase">From</span>
                      <input 
                        type="date" 
                        value={reportStartDate}
                        onChange={(e) => setReportStartDate(e.target.value)}
                        className="text-sm font-medium outline-none"
                      />
                    </div>
                    <div className="flex items-center gap-2 bg-white px-3 py-2 rounded-xl border border-gray-100 shadow-sm">
                      <span className="text-xs font-bold text-gray-400 uppercase">To</span>
                      <input 
                        type="date" 
                        value={reportEndDate}
                        onChange={(e) => setReportEndDate(e.target.value)}
                        className="text-sm font-medium outline-none"
                      />
                    </div>
                    <Button 
                      onClick={exportToExcel}
                      variant="secondary"
                      className="flex items-center gap-2"
                      disabled={filteredTransactions.length === 0}
                    >
                      <Download size={18} />
                      Export Excel
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <Card className="bg-red-50 border-red-100">
                    <p className="text-red-600 text-xs font-bold uppercase tracking-wider mb-1">Total Transactions</p>
                    <p className="text-2xl font-black text-gray-900">{filteredTransactions.length}</p>
                  </Card>
                  <Card className="bg-blue-50 border-blue-100">
                    <p className="text-blue-600 text-xs font-bold uppercase tracking-wider mb-1">Items Issued</p>
                    <p className="text-2xl font-black text-gray-900">
                      {filteredTransactions.filter(t => t.type === 'ISSUE').reduce((acc, t) => acc + t.quantity, 0)}
                    </p>
                  </Card>
                  <Card className="bg-emerald-50 border-emerald-100">
                    <p className="text-emerald-600 text-xs font-bold uppercase tracking-wider mb-1">Items Returned</p>
                    <p className="text-2xl font-black text-gray-900">
                      {filteredTransactions.filter(t => t.type === 'RETURN').reduce((acc, t) => acc + t.quantity, 0)}
                    </p>
                  </Card>
                </div>

                <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-50 text-gray-500 text-xs uppercase font-bold tracking-wider">
                          <th className="px-6 py-4">PO Number</th>
                          <th className="px-6 py-4">Staff</th>
                          <th className="px-6 py-4">Product</th>
                          <th className="px-6 py-4">Qty</th>
                          <th className="px-6 py-4">Type</th>
                          <th className="px-6 py-4">Date & Time</th>
                          <th className="px-6 py-4 text-center">Receipt</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {filteredTransactions.length === 0 ? (
                          <tr>
                            <td colSpan={7} className="px-6 py-12 text-center text-gray-400">
                              No transactions found for the selected range.
                            </td>
                          </tr>
                        ) : (
                          filteredTransactions.map(t => (
                            <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                              <td className="px-6 py-4 font-bold text-gray-900">{t.poNumber}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{t.staffName}</td>
                              <td className="px-6 py-4 text-sm text-gray-600">{t.productName}</td>
                              <td className="px-6 py-4 text-sm font-bold">{t.quantity}</td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-2 py-1 rounded-lg text-[10px] font-bold uppercase",
                                  t.type === 'ISSUE' ? "bg-red-50 text-[#E21F26]" : "bg-blue-50 text-blue-600"
                                )}>
                                  {t.type}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-sm text-gray-500">
                                {format(parseISO(t.timestamp), 'dd MMM, hh:mm a')}
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button 
                                  onClick={() => {
                                    const s = staff.find(st => st.id === t.staffId);
                                    const p = products.find(pr => pr.id === t.productId);
                                    if (s && p) generateReceiptPDF(
                                      t.poNumber, 
                                      s, 
                                      p, 
                                      t.serialNumbers, 
                                      t.quantity, 
                                      t.amount || 0,
                                      t.paymentType || 'Cash',
                                      t.productHead || p.category,
                                      t.type, 
                                      t.timestamp,
                                      t.remarks
                                    );
                                  }}
                                  className="p-2 bg-[#E21F26] text-white rounded-lg hover:bg-red-700 transition-all shadow-sm"
                                >
                                  <Download size={16} />
                                </button>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'utilities' && (
              <motion.div 
                key="utilities"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="max-w-2xl mx-auto space-y-6"
              >
                <h2 className="text-2xl font-bold text-gray-900">System Utilities</h2>
                <Card>
                  <h3 className="font-bold text-lg mb-4">Database Management</h3>
                  <p className="text-sm text-gray-500 mb-6">
                    Manage system-wide settings and data integrity tools.
                  </p>
                  <div className="space-y-4">
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                      <div>
                        <p className="font-bold text-gray-900">Auto-Sync Status</p>
                        <p className="text-xs text-emerald-600">Active & Connected</p>
                      </div>
                      <div className="w-3 h-3 bg-emerald-500 rounded-full animate-pulse"></div>
                    </div>
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-xl">
                      <div>
                        <p className="font-bold text-gray-900">PO Sequence</p>
                        <p className="text-xs text-gray-500">Next: PO-{new Date().getFullYear()}-XXXX</p>
                      </div>
                      <SettingsIcon size={20} className="text-gray-400" />
                    </div>
                  </div>
                </Card>

                <Card>
                  <h3 className="font-bold text-lg mb-4">Profile Settings</h3>
                  <div className="flex flex-col items-center gap-6 p-4">
                    <div className="relative group">
                      <div className="w-32 h-32 rounded-full overflow-hidden border-4 border-gray-100 shadow-inner bg-gray-50 flex items-center justify-center">
                        {userProfile?.photoURL || user.photoURL ? (
                          <img 
                            src={userProfile?.photoURL || user.photoURL || ''} 
                            alt="Profile" 
                            className="w-full h-full object-cover"
                            referrerPolicy="no-referrer"
                          />
                        ) : (
                          <UserIcon size={48} className="text-gray-300" />
                        )}
                        {isUploadingProfile && (
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                          </div>
                        )}
                      </div>
                      <label className="absolute bottom-0 right-0 p-2 bg-[#E21F26] text-white rounded-full shadow-lg cursor-pointer hover:bg-red-700 transition-colors">
                        <Camera size={20} />
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleProfileUpload}
                          disabled={isUploadingProfile}
                        />
                      </label>
                    </div>
                    <div className="text-center w-full max-w-xs">
                      {isEditingName ? (
                        <div className="flex items-center gap-2 mb-2">
                          <input 
                            type="text" 
                            value={newName}
                            onChange={(e) => setNewName(e.target.value)}
                            className="flex-1 px-3 py-2 border border-gray-200 rounded-xl outline-none focus:border-[#E21F26] text-center font-bold"
                            placeholder="Enter new name"
                            autoFocus
                          />
                          <button 
                            onClick={handleUpdateName}
                            className="p-2 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-colors"
                          >
                            <CheckCircle2 size={20} />
                          </button>
                          <button 
                            onClick={() => { setIsEditingName(false); setNewName(user?.displayName || ''); }}
                            className="p-2 bg-gray-100 text-gray-500 rounded-xl hover:bg-gray-200 transition-colors"
                          >
                            <X size={20} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center justify-center gap-2 mb-1">
                          <p className="font-bold text-xl text-gray-900">{user.displayName}</p>
                          <button 
                            onClick={() => { setIsEditingName(true); setNewName(user.displayName || ''); }}
                            className="p-1 text-gray-400 hover:text-[#E21F26] transition-colors"
                          >
                            <Edit2 size={16} />
                          </button>
                        </div>
                      )}
                      <p className="text-gray-500">{user.email}</p>
                      <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 text-[#E21F26] rounded-full text-xs font-bold uppercase tracking-wider">
                        IT Officer
                      </div>
                    </div>
                  </div>
                </Card>
              </motion.div>
            )}
          </AnimatePresence>
        </main>

        {/* Modals */}
        <Modal
          isOpen={!!deleteConfirmation}
          onClose={() => setDeleteConfirmation(null)}
          title="Confirm Permanent Deletion"
        >
          <div className="p-6 text-center">
            <div className="w-16 h-16 bg-red-50 text-red-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <AlertCircle size={32} />
            </div>
            <h3 className="text-xl font-bold text-gray-900 mb-2">Absolute Deletion Power</h3>
            <p className="text-gray-500 mb-6">
              You are about to permanently delete <span className="font-bold text-gray-900">"{deleteConfirmation?.name}"</span>. 
              This action will instantly wipe all associated data from the cloud backend. This cannot be undone.
            </p>
            <div className="flex gap-3">
              <Button 
                variant="secondary" 
                onClick={() => setDeleteConfirmation(null)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button 
                variant="primary" 
                onClick={deleteRecord}
                className="flex-1 bg-red-600 hover:bg-red-700"
              >
                Permanently Delete
              </Button>
            </div>
          </div>
        </Modal>

        <Modal 
          isOpen={isProductModalOpen} 
          onClose={() => setIsProductModalOpen(false)} 
          title={editingProduct ? 'Edit Product' : 'Add New Product'}
        >
          <form onSubmit={saveProduct} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Product Name</label>
              <input 
                name="name" 
                defaultValue={editingProduct?.name} 
                required 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Category</label>
              <input 
                name="category" 
                defaultValue={editingProduct?.category} 
                required 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Initial Stock</label>
                <input 
                  name="totalStock" 
                  type="number" 
                  defaultValue={editingProduct?.totalStock} 
                  required 
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Unit Price (BDT)</label>
                <input 
                  name="unitPrice" 
                  type="number" 
                  step="0.01"
                  defaultValue={editingProduct?.unitPrice} 
                  required 
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Unit (e.g. Pcs)</label>
              <input 
                name="unit" 
                defaultValue={editingProduct?.unit || 'Pcs'} 
                required 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>
            <Button type="submit" className="w-full mt-4">Save Product</Button>
          </form>
        </Modal>

        <Modal 
          isOpen={isStaffModalOpen} 
          onClose={() => setIsStaffModalOpen(false)} 
          title={editingStaff ? 'Edit Staff Profile' : 'Add New Staff'}
        >
          <form onSubmit={saveStaff} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Full Name</label>
              <input 
                name="name" 
                defaultValue={editingStaff?.name} 
                required 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Designation</label>
              <input 
                name="designation" 
                defaultValue={editingStaff?.designation} 
                required 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">GP Mobile Number (11 Digits)</label>
              <input 
                name="mobile" 
                defaultValue={editingStaff?.mobile} 
                required 
                maxLength={11}
                placeholder="017XXXXXXXX"
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>
            <Button type="submit" className="w-full mt-4">Save Profile</Button>
          </form>
        </Modal>

        <Modal 
          isOpen={isTransactionModalOpen} 
          onClose={() => { setIsTransactionModalOpen(false); resetTransactionForm(); }} 
          title={transactionType === 'ISSUE' ? 'Issue Stock to Staff' : 'Return Stock from Staff'}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className={cn(
                "p-4 rounded-xl border-2 cursor-pointer transition-all text-center",
                transactionType === 'ISSUE' ? "border-[#E21F26] bg-red-50" : "border-gray-100 bg-white"
              )} onClick={() => setTransactionType('ISSUE')}>
                <Plus size={20} className={cn("mx-auto mb-2", transactionType === 'ISSUE' ? "text-[#E21F26]" : "text-gray-400")} />
                <span className={cn("text-sm font-bold", transactionType === 'ISSUE' ? "text-[#E21F26]" : "text-gray-500")}>ISSUE</span>
              </div>
              <div className={cn(
                "p-4 rounded-xl border-2 cursor-pointer transition-all text-center",
                transactionType === 'RETURN' ? "border-blue-600 bg-blue-50" : "border-gray-100 bg-white"
              )} onClick={() => setTransactionType('RETURN')}>
                <ArrowRightLeft size={20} className={cn("mx-auto mb-2", transactionType === 'RETURN' ? "text-blue-600" : "text-gray-400")} />
                <span className={cn("text-sm font-bold", transactionType === 'RETURN' ? "text-blue-600" : "text-gray-500")}>RETURN</span>
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Select Staff</label>
              <select 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none"
                onChange={(e) => setSelectedStaff(staff.find(s => s.id === e.target.value) || null)}
                value={selectedStaff?.id || ''}
              >
                <option value="">-- Choose Staff --</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.designation})</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Select Product</label>
              <select 
                className="w-full px-4 py-2 rounded-xl border border-gray-200 outline-none"
                onChange={(e) => setSelectedProduct(products.find(p => p.id === e.target.value) || null)}
                value={selectedProduct?.id || ''}
              >
                <option value="">-- Choose Product --</option>
                {products.map(p => <option key={p.id} value={p.id}>{p.name} (Stock: {p.totalStock})</option>)}
              </select>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Product Head (Optional)</label>
              <input 
                value={productHead}
                onChange={(e) => setProductHead(e.target.value)}
                placeholder="e.g. SIM KIT"
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Quantity</label>
                <input 
                  type="number"
                  value={transactionQty}
                  onChange={(e) => setTransactionQty(Number(e.target.value))}
                  min={1}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
                />
              </div>
              <div>
                <label className="block text-sm font-bold text-gray-700 mb-1">Amount (BDT)</label>
                <input 
                  type="number"
                  value={transactionAmount}
                  onChange={(e) => setTransactionAmount(Number(e.target.value))}
                  min={0}
                  className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Payment Type</label>
              <div className="flex gap-4">
                {['Cash', 'Credit'].map(type => (
                  <label key={type} className="flex items-center gap-2 cursor-pointer">
                    <input 
                      type="radio" 
                      name="paymentType" 
                      checked={paymentType === type}
                      onChange={() => setPaymentType(type as PaymentType)}
                      className="text-[#E21F26] focus:ring-[#E21F26]"
                    />
                    <span className="text-sm font-medium text-gray-700">{type}</span>
                  </label>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Remarks</label>
              <textarea 
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                placeholder="Additional notes..."
                className="w-full px-4 py-2 rounded-xl border border-gray-200 focus:border-[#E21F26] focus:ring-1 focus:ring-[#E21F26] outline-none h-20 resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-bold text-gray-700 mb-1">Add Serial Numbers</label>
              <div className="flex gap-2 mb-2">
                <input 
                  value={serialInput}
                  onChange={(e) => setSerialInput(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addSerial()}
                  placeholder="Scan or type serial..."
                  className="flex-1 px-4 py-2 rounded-xl border border-gray-200 outline-none"
                />
                <Button onClick={addSerial} variant="secondary">Add</Button>
              </div>
              <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto p-2 bg-gray-50 rounded-xl">
                {serials.length === 0 && <p className="text-xs text-gray-400 italic">No serials added yet</p>}
                {serials.map(s => (
                  <span key={s} className="px-2 py-1 bg-white border border-gray-200 rounded-lg text-xs font-medium flex items-center gap-1">
                    {s}
                    <button onClick={() => setSerials(serials.filter(x => x !== s))} className="text-gray-400 hover:text-red-500">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
            </div>

            <Button onClick={processTransaction} className="w-full py-4">
              Process {transactionType} & Generate Receipt
            </Button>
          </div>
        </Modal>

        <Modal
          isOpen={!!viewingStaffDetails}
          onClose={() => setViewingStaffDetails(null)}
          title={`Inventory: ${viewingStaffDetails?.name}`}
        >
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-2xl">
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Total Holdings</p>
                <p className="text-2xl font-black text-gray-900">
                  {viewingStaffDetails?.holdings?.reduce((acc, h) => acc + h.qtyHeld, 0) || 0}
                </p>
              </div>
              <div className="p-4 bg-gray-50 rounded-2xl">
                <p className="text-xs text-gray-500 uppercase font-bold tracking-wider mb-1">Active Products</p>
                <p className="text-2xl font-black text-gray-900">
                  {viewingStaffDetails?.holdings?.length || 0}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <h3 className="font-bold text-gray-900 flex items-center gap-2">
                <Package size={18} className="text-[#E21F26]" />
                Live Product Summary
              </h3>
              <div className="space-y-2">
                {viewingStaffDetails?.holdings && viewingStaffDetails.holdings.length > 0 ? (
                  viewingStaffDetails.holdings.map(h => (
                    <div key={h.productId} className="p-4 border border-gray-100 rounded-xl flex items-center justify-between hover:border-red-100 transition-colors">
                      <div>
                        <p className="font-bold text-gray-900">{h.productName}</p>
                        <p className="text-xs text-gray-500">{h.serialNumbers.length} Serials Tracked</p>
                      </div>
                      <div className="text-right">
                        <p className="text-lg font-black text-[#E21F26]">{h.qtyHeld}</p>
                        <p className="text-[10px] text-gray-400 uppercase font-bold">Units</p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200">
                    <AlertCircle size={32} className="mx-auto text-gray-300 mb-2" />
                    <p className="text-sm font-bold text-gray-400 uppercase tracking-widest">Out of Stock</p>
                    <p className="text-xs text-gray-400">No active inventory held by this staff</p>
                  </div>
                )}
              </div>
            </div>

            {viewingStaffDetails?.holdings && viewingStaffDetails.holdings.length > 0 && (
              <div className="p-4 bg-red-50 rounded-xl border border-red-100">
                <div className="flex gap-3">
                  <AlertCircle className="text-[#E21F26] shrink-0" size={20} />
                  <div>
                    <p className="text-sm font-bold text-red-900">Inventory Notice</p>
                    <p className="text-xs text-red-700 leading-relaxed">
                      Staff is responsible for all serial numbers listed above. Returns must match issued serials.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      </div>
    </ErrorBoundary>
  );
}
