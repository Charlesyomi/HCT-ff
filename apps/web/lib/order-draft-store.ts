import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type { OrderFormInput } from './order-form';

export type OrderSourceIntent = 'bulk' | 'smoking' | null;

type OrderDraftState = {
    draft: Partial<OrderFormInput>;
    sourceIntent: OrderSourceIntent;
    quantityPresetKg: number | null;
    tonnePlusCustom: boolean;
    mobileStep: number;
    reviewOpen: boolean;
    idempotencyKey: string | null;
    hasHydrated: boolean;
    mergeDraft: (values: Partial<OrderFormInput>) => void;
    setSourceIntent: (intent: OrderSourceIntent) => void;
    setQuantityPresetKg: (quantity: number | null) => void;
    setTonnePlusCustom: (enabled: boolean) => void;
    setMobileStep: (step: number) => void;
    setReviewOpen: (open: boolean) => void;
    setIdempotencyKey: (key: string | null) => void;
    setHasHydrated: (hasHydrated: boolean) => void;
    clearDraft: () => void;
};

export const useOrderDraftStore = create<OrderDraftState>()(
    persist(
        (set) => ({
            draft: {},
            sourceIntent: null,
            quantityPresetKg: null,
            tonnePlusCustom: false,
            mobileStep: 0,
            reviewOpen: false,
            idempotencyKey: null,
            hasHydrated: false,
            mergeDraft: (values) => set((state) => ({ draft: { ...state.draft, ...values } })),
            setSourceIntent: (sourceIntent) => set({ sourceIntent }),
            setQuantityPresetKg: (quantityPresetKg) => set({ quantityPresetKg }),
            setTonnePlusCustom: (tonnePlusCustom) => set({ tonnePlusCustom }),
            setMobileStep: (mobileStep) => set({ mobileStep }),
            setReviewOpen: (reviewOpen) => set({ reviewOpen }),
            setIdempotencyKey: (idempotencyKey) => set({ idempotencyKey }),
            setHasHydrated: (hasHydrated) => set({ hasHydrated }),
            clearDraft: () => set({
                draft: {},
                sourceIntent: null,
                quantityPresetKg: null,
                tonnePlusCustom: false,
                mobileStep: 0,
                reviewOpen: false,
                idempotencyKey: null,
            }),
        }),
        {
            name: 'adesoba-order-draft',
            storage: createJSONStorage(() => sessionStorage),
            skipHydration: true,
            partialize: ({
                draft,
                sourceIntent,
                quantityPresetKg,
                tonnePlusCustom,
                mobileStep,
                reviewOpen,
                idempotencyKey,
            }) => ({
                draft,
                sourceIntent,
                quantityPresetKg,
                tonnePlusCustom,
                mobileStep,
                reviewOpen,
                idempotencyKey,
            }),
            onRehydrateStorage: () => (state) => state?.setHasHydrated(true),
        },
    ),
);
