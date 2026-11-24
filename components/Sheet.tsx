"use client";

import { AnimatePresence, motion } from "motion/react";

/** 아래에서 올라오는 시트 (설문의 직접 추가·제출 창) */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-40 flex items-end justify-center bg-black/50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="max-h-[88vh] w-full max-w-xl overflow-auto rounded-t-3xl bg-white p-5 pb-8 shadow-2xl dark:bg-zinc-900"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** 화면 가운데 확인 창 (관리자의 삭제 확인) */
export function Modal({ open, onClose, children, wide = false, xl = false }: { open: boolean; onClose: () => void; children: React.ReactNode; wide?: boolean; xl?: boolean }) {
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            onClick={e => e.stopPropagation()}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className={`w-full max-h-[90vh] overflow-y-auto overscroll-contain ${xl ? "max-w-3xl" : wide ? "max-w-xl" : "max-w-sm"} rounded-2xl bg-white p-5 shadow-2xl dark:bg-zinc-900`}
            role="dialog"
            aria-modal="true"
          >
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
