import { db } from '../firebase';
import { doc, getDoc, setDoc, runTransaction } from 'firebase/firestore';

export async function generatePONumber(): Promise<string> {
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `po-${year}`);

  return await runTransaction(db, async (transaction) => {
    const counterDoc = await transaction.get(counterRef);
    
    let nextValue = 1;
    if (counterDoc.exists()) {
      nextValue = counterDoc.data().lastValue + 1;
    }

    transaction.set(counterRef, {
      lastValue: nextValue,
      year: year
    });

    const paddedNumber = nextValue.toString().padStart(4, '0');
    return `PO-${year}-${paddedNumber}`;
  });
}
