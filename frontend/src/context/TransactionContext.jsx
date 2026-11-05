import React, { createContext, useContext, useState } from 'react';

const TransactionContext = createContext(null);

export function TransactionProvider({ children }) {
  const [isTransacting, setIsTransacting] = useState(false);
  return (
    <TransactionContext.Provider value={{ isTransacting, setIsTransacting }}>
      {children}
    </TransactionContext.Provider>
  );
}

export function useTransactionState() {
  const context = useContext(TransactionContext);
  if (!context) throw new Error('useTransactionState must be used within TransactionProvider');
  return context;
}
