'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle, MessageCircle, Phone } from 'lucide-react';
import { z } from 'zod';
import type { Catalog, SizeClass } from '@/lib/catalog-api';
import { createOrderFormSchema, defaultPreferredDate, deliveryAddressSchema, type OrderFormInput, type OrderFormValues } from '@/lib/order-form';
import { useOrderDraftStore, type OrderSourceIntent } from '@/lib/order-draft-store';
import { StatusPill } from '@/components/catalog/status-pill';

const fishOptions = [
    { value: 'clarias', label: 'Clarias', description: 'Common and widely available.' },
    { value: 'hybrid', label: 'Hybrid', description: 'Fast growing, good for bulk orders.' },
    { value: 'any', label: 'Either – No preference', description: "We'll give you what's available." },
] as const;

const quantityOptions = [40, 100, 200, 500, 1000] as const;
const mobileStepFields: readonly (readonly (keyof OrderFormInput)[])[] = [
    ['fish_type'],
    ['size'],
    ['quantity_kg'],
    ['preferred_date', 'time_slot'],
    ['fulfilment', 'delivery_address', 'delivery_landmark'],
    ['notes'],
];
const orderQuestionFields: readonly (keyof OrderFormInput)[] = [
    'fish_type',
    'size',
    'quantity_kg',
    'preferred_date',
    'time_slot',
    'fulfilment',
    'delivery_address',
    'delivery_landmark',
    'notes',
];

const orderResponseSchema = z.object({ reference: z.string().min(1) });
const errorResponseSchema = z.object({ error: z.object({ message: z.string() }) });

const steps = ['Your Order', 'Review & Confirm', 'Get Quote'] as const;

function FieldError({ id, message }: { id: string; message?: string }) {
    if (!message) return null;
    return <p id={id} role="alert" className="mt-2 text-sm font-medium text-status-error">{message}</p>;
}

function SectionHeading({ number, children }: { number: number; children: string }) {
    return (
        <div className="mb-4 flex items-center gap-3">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-700)] font-display font-bold text-white">{number}</span>
            <h2 className="font-display text-xl font-bold text-ink">{children}</h2>
        </div>
    );
}

function Stepper({ activeStep }: { activeStep: number }) {
    return (
        <ol aria-label="Order progress" className="mb-8 grid grid-cols-3 border-b border-line-soft">
            {steps.map((step, index) => {
                const number = index + 1;
                const isActive = activeStep === number;
                const isComplete = activeStep > number;
                return (
                    <li key={step} aria-current={isActive ? 'step' : undefined} className={`flex min-h-14 items-center gap-3 border-b-2 px-2 pb-3 ${isActive ? 'border-[color:var(--brand-700)] text-brand-900' : isComplete ? 'border-line-accent text-brand-900' : 'border-transparent text-ink-muted'}`}>
                        <span className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full font-display font-bold ${isActive || isComplete ? 'bg-[color:var(--brand-700)] text-white' : 'bg-canvas-tint text-ink-muted'}`}>
                            {isComplete ? <Check aria-hidden="true" size={16} /> : number}
                        </span>
                        <span className="hidden text-sm font-semibold sm:inline">{step}</span>
                    </li>
                );
            })}
        </ol>
    );
}

function DotProgress({ activeStep }: { activeStep: number }) {
    return (
        <div className="mb-6 flex items-center justify-center gap-3 lg:hidden" aria-label={`Question ${Math.min(activeStep + 1, 6)} of 6`}>
            {Array.from({ length: 6 }, (_, index) => (
                <span key={index} className={`h-2.5 w-2.5 rounded-full ${index <= activeStep ? 'bg-[color:var(--brand-700)]' : 'bg-[color:var(--border-strong)]'}`} />
            ))}
            <span className="sr-only">Question {Math.min(activeStep + 1, 6)} of 6</span>
        </div>
    );
}

function QuestionSection({
    number,
    title,
    active,
    children,
}: {
    number: number;
    title: string;
    active: boolean;
    children: React.ReactNode;
}) {
    return (
        <section className={`${active ? 'block' : 'hidden'} border-b border-line-soft py-6 first:pt-0 lg:block`}>
            <SectionHeading number={number}>{title}</SectionHeading>
            {children}
        </section>
    );
}

function AvailabilitySidebar({ catalog }: { catalog: Catalog | null }) {
    const whatsappDigits = catalog?.settings.whatsapp_number.replace(/\D/g, '');
    const whatsappHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent('Hi Adesoba Farm, I would like help choosing fish for an order.')}`
        : '/contact';

    return (
        <aside className="hidden space-y-6 lg:block">
            <section className="border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] p-5">
                <h2 className="font-display text-xl font-bold text-ink">Current Availability</h2>
                {catalog?.harvest_window ? (
                    <p className="mt-2 text-sm text-ink-muted">Next harvest: {catalog.harvest_window.starts_on} – {catalog.harvest_window.ends_on}</p>
                ) : (
                    <p className="mt-2 text-sm text-ink-muted">Next harvest date to be announced. You can still send a request.</p>
                )}
                <ul className="mt-4 space-y-3">
                    {catalog?.size_classes.map((size) => (
                        <li key={size.slug} className="flex items-center justify-between gap-2 text-sm">
                            <span className="text-ink">{size.label}</span>
                            <StatusPill status={size.status} />
                        </li>
                    ))}
                </ul>
                {!catalog ? <p className="mt-3 text-sm text-status-error">Availability is temporarily unavailable.</p> : null}
            </section>
            <section className="border-t border-line-soft pt-5">
                <h2 className="font-display text-xl font-bold text-ink">Why Order With Us</h2>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-ink-muted">
                    <li>Healthy, well-raised Clarias and Hybrid.</li>
                    <li>Pickup or delivery arrangements confirmed with you.</li>
                    <li>Current price confirmed by the farm. No online payment.</li>
                </ul>
            </section>
            <section className="bg-[color:var(--brand-900)] p-5 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-100">Need a hand?</p>
                <h2 className="mt-2 font-display text-xl font-bold">Quality Catfish. Real Business.</h2>
                <a href={whatsappHref} className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[#c5f03a] px-4 font-semibold text-[#20320b]">
                    <MessageCircle aria-hidden="true" className="mr-2" size={17} />Talk on WhatsApp
                </a>
            </section>
        </aside>
    );
}

function OrderQuestions({
    catalog,
    activeMobileStep,
    onCheckAvailability,
    onNext,
    onBack,
    pending,
}: {
    catalog: Catalog | null;
    activeMobileStep: number;
    onCheckAvailability: () => void;
    onNext: () => void;
    onBack: () => void;
    pending: boolean;
}) {
    const {
        register,
        setValue,
        control,
        trigger,
        formState: { errors },
    } = useFormContext<OrderFormInput>();
    const fulfilment = useWatch({ control, name: 'fulfilment' });
    const selectedSize = useWatch({ control, name: 'size' });
    const quantity = useWatch({ control, name: 'quantity_kg' });
    const customQuantity = useWatch({ control, name: 'custom_quantity_kg' });
    const preferredDate = useWatch({ control, name: 'preferred_date' });
    const notes = useWatch({ control, name: 'notes' }) ?? '';
    const sizes = catalog?.size_classes ?? [];
    const timeSlots = catalog?.settings.time_slots ?? [];
    const minOrder = catalog?.settings.min_order_kg ?? 40;
    const maxOrder = catalog?.settings.max_order_kg ?? 20_000;
    const leadDays = catalog?.settings.min_lead_days ?? 1;
    const harvestWindow = catalog?.harvest_window;
    const quantityPresetKg = useOrderDraftStore((state) => state.quantityPresetKg);
    const tonnePlusCustom = useOrderDraftStore((state) => state.tonnePlusCustom);
    const sourceIntent = useOrderDraftStore((state) => state.sourceIntent);
    const setQuantityPresetKg = useOrderDraftStore((state) => state.setQuantityPresetKg);
    const setTonnePlusCustom = useOrderDraftStore((state) => state.setTonnePlusCustom);

    function chooseQuantity(value: number) {
        setQuantityPresetKg(value);
        setTonnePlusCustom(value === 1000);
        setValue('quantity_kg', value, { shouldDirty: true, shouldTouch: true, shouldValidate: true });
        setValue('custom_quantity_kg', value === 1000 ? 1000 : undefined, { shouldDirty: true });
    }

    const isOutsideHarvest = Boolean(
        preferredDate && harvestWindow &&
        (preferredDate < harvestWindow.starts_on || preferredDate > harvestWindow.ends_on),
    );
    const isSunday = preferredDate && new Date(`${preferredDate}T00:00:00Z`).getUTCDay() === 0;

    return (
        <>
            <QuestionSection number={1} title="What kind of fish do you want?" active={activeMobileStep === 0}>
                <fieldset>
                    <legend className="sr-only">Choose a fish type</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                        {fishOptions.map((option) => (
                            <label key={option.value} className="relative flex min-h-24 cursor-pointer gap-3 rounded-xl border border-line-soft bg-canvas p-4 transition has-[:checked]:border-2 has-[:checked]:border-[color:var(--brand-700)] has-[:checked]:bg-[color:var(--brand-100)] focus-within:ring-2 focus-within:ring-[color:var(--brand-700)]">
                                <input className="mt-1 accent-[color:var(--brand-700)]" type="radio" value={option.value} {...register('fish_type')} />
                                <span>
                                    <span className="block font-semibold text-ink">{option.label}</span>
                                    <span className="mt-1 block text-sm leading-5 text-ink-muted">{option.description}</span>
                                </span>
                            </label>
                        ))}
                    </div>
                    <FieldError id="fish-type-error" message={errors.fish_type?.message} />
                </fieldset>
            </QuestionSection>

            <QuestionSection number={2} title="What size do you need?" active={activeMobileStep === 1}>
                {sizes.length ? (
                    <fieldset>
                        <legend className="sr-only">Choose a size class</legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                            {sizes.map((size) => <SizeChoice key={size.slug} size={size} selected={selectedSize === size.slug} />)}
                        </div>
                        <FieldError id="size-error" message={errors.size?.message} />
                    </fieldset>
                ) : (
                    <div className="border-y border-line-soft py-5 text-sm text-ink-muted">
                        {catalog ? 'No fish sizes are available in the catalog right now.' : 'Live sizes are temporarily unavailable.'}
                        <p className="mt-2"><Link href="/contact" className="font-semibold text-[color:var(--brand-700)]">Contact the farm</Link> for help with your request.</p>
                    </div>
                )}
            </QuestionSection>

            <QuestionSection number={3} title="How much do you need?" active={activeMobileStep === 2}>
                <div className="flex flex-wrap gap-2" role="group" aria-label="Common order quantities">
                    {quantityOptions.map((value) => (
                        <button
                            key={value}
                            type="button"
                            aria-pressed={quantityPresetKg === value}
                            onClick={() => chooseQuantity(value)}
                            className={`min-h-11 rounded-full border px-4 text-sm font-semibold transition ${quantityPresetKg === value ? 'border-[color:var(--brand-700)] bg-[color:var(--brand-100)] text-brand-900' : 'border-line-soft bg-canvas text-ink hover:border-[color:var(--brand-700)]'}`}
                        >
                            {value === 1000 ? '1 tonne+' : `${value}kg`}
                        </button>
                    ))}
                </div>
                {sourceIntent === 'bulk' ? <p className="mt-3 text-sm text-ink-muted">For 1 tonne+ choose 1 tonne+.</p> : null}
                <label htmlFor="quantity-kg" className="mt-5 block text-sm font-semibold text-ink">Custom amount (kg)</label>
                <input
                    id="quantity-kg"
                    type="number"
                    min={tonnePlusCustom ? 1000 : minOrder}
                    max={maxOrder}
                    step={1}
                    inputMode="numeric"
                    aria-invalid={Boolean(errors.quantity_kg)}
                    aria-describedby={errors.quantity_kg ? 'quantity-error' : 'quantity-hint'}
                    {...register('custom_quantity_kg')}
                    value={customQuantity ?? ''}
                    onChange={(event) => {
                        const rawValue = event.currentTarget.value;
                        const customValue = rawValue === '' ? undefined : Number(rawValue);
                        setQuantityPresetKg(null);
                        setValue('custom_quantity_kg', customValue, { shouldDirty: true });
                        setValue('quantity_kg', customValue ?? Number.NaN, {
                            shouldDirty: true,
                            shouldTouch: true,
                            shouldValidate: true,
                        });
                    }}
                    className="mt-2 min-h-12 w-full max-w-sm rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                    placeholder={`Minimum ${minOrder}kg`}
                />
                <p id="quantity-hint" className="mt-2 text-sm text-ink-muted">Minimum {minOrder}kg. Quantities of 1 tonne or more are bulk orders.</p>
                <FieldError id="quantity-error" message={errors.quantity_kg?.message} />
            </QuestionSection>

            <QuestionSection number={4} title="When do you need it?" active={activeMobileStep === 3}>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <label htmlFor="preferred-date" className="block text-sm font-semibold text-ink">Preferred date</label>
                        <input
                            id="preferred-date"
                            type="date"
                            min={defaultPreferredDate(leadDays)}
                            max={defaultPreferredDate(90)}
                            aria-invalid={Boolean(errors.preferred_date)}
                            aria-describedby={errors.preferred_date ? 'date-error' : undefined}
                            {...register('preferred_date')}
                            className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                        />
                        <FieldError id="date-error" message={errors.preferred_date?.message} />
                        {isOutsideHarvest && harvestWindow ? (
                            <p className="mt-2 text-sm text-ink-muted">Our next harvest is {harvestWindow.starts_on}–{harvestWindow.ends_on}. We’ll confirm the best date with you.</p>
                        ) : null}
                        {isSunday ? <p className="mt-2 text-sm text-ink-muted">Sunday requests are subject to confirmation.</p> : null}
                    </div>
                    <div>
                        <label htmlFor="time-slot" className="block text-sm font-semibold text-ink">Preferred time slot</label>
                        <select
                            id="time-slot"
                            aria-invalid={Boolean(errors.time_slot)}
                            aria-describedby={errors.time_slot ? 'time-slot-error' : undefined}
                            {...register('time_slot')}
                            className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-3 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                        >
                            <option value="">Choose a time</option>
                            {timeSlots.map((slot) => <option key={slot.key} value={slot.key}>{slot.label}</option>)}
                        </select>
                        <FieldError id="time-slot-error" message={errors.time_slot?.message} />
                    </div>
                </div>
            </QuestionSection>

            <QuestionSection number={5} title="Pickup or delivery?" active={activeMobileStep === 4}>
                <fieldset>
                    <legend className="sr-only">Choose pickup or delivery</legend>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-line-soft bg-canvas p-4 has-[:checked]:border-2 has-[:checked]:border-[color:var(--brand-700)] has-[:checked]:bg-[color:var(--brand-100)] focus-within:ring-2 focus-within:ring-[color:var(--brand-700)]">
                            <input type="radio" value="pickup" {...register('fulfilment')} className="accent-[color:var(--brand-700)]" />
                            <span><span className="block font-semibold text-ink">Pickup</span><span className="mt-1 block text-sm text-ink-muted">Collect from the farm.</span></span>
                        </label>
                        <label className="flex min-h-16 cursor-pointer items-center gap-3 rounded-xl border border-line-soft bg-canvas p-4 has-[:checked]:border-2 has-[:checked]:border-[color:var(--brand-700)] has-[:checked]:bg-[color:var(--brand-100)] focus-within:ring-2 focus-within:ring-[color:var(--brand-700)]">
                            <input type="radio" value="delivery" {...register('fulfilment')} className="accent-[color:var(--brand-700)]" />
                            <span><span className="block font-semibold text-ink">Delivery</span><span className="mt-1 block text-sm text-ink-muted">We’ll confirm the service area.</span></span>
                        </label>
                    </div>
                    <FieldError id="fulfilment-error" message={errors.fulfilment?.message} />
                </fieldset>
                {fulfilment === 'delivery' ? (
                    <div className="mt-5 grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label htmlFor="delivery-address" className="block text-sm font-semibold text-ink">Delivery address / area</label>
                            <input id="delivery-address" autoComplete="street-address" aria-invalid={Boolean(errors.delivery_address)} aria-describedby={errors.delivery_address ? 'delivery-address-error' : 'delivery-fee-note'} {...register('delivery_address')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="Street, area, town" />
                            <FieldError id="delivery-address-error" message={errors.delivery_address?.message} />
                        </div>
                        <div className="sm:col-span-2">
                            <label htmlFor="delivery-landmark" className="block text-sm font-semibold text-ink">Landmark or extra directions <span className="font-normal text-ink-muted">(optional)</span></label>
                            <input id="delivery-landmark" autoComplete="off" {...register('delivery_landmark')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="Nearby landmark or directions" />
                        </div>
                        <p id="delivery-fee-note" className="sm:col-span-2 text-sm text-ink-muted">Additional fee may apply.</p>
                    </div>
                ) : null}
            </QuestionSection>

            <QuestionSection number={6} title="Any special instructions?" active={activeMobileStep === 5}>
                <label htmlFor="order-notes" className="block text-sm font-semibold text-ink">Notes <span className="font-normal text-ink-muted">(optional)</span></label>
                <textarea
                    id="order-notes"
                    rows={4}
                    maxLength={500}
                    aria-describedby="notes-counter"
                    {...register('notes')}
                    className="mt-2 w-full rounded-lg border border-line-strong bg-canvas px-4 py-3 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]"
                    placeholder="Anything else the farm should know?"
                />
                <p id="notes-counter" className="mt-2 text-right text-sm text-ink-muted">{notes.length}/500</p>
            </QuestionSection>

            <div className="mt-7 hidden items-center justify-between gap-3 lg:flex">
                <Link href="/" className="inline-flex min-h-11 items-center rounded-full border border-line-soft px-5 font-semibold text-ink hover:bg-canvas-tint">Back to Home</Link>
                <button type="button" onClick={onCheckAvailability} disabled={pending} className="inline-flex min-h-12 items-center rounded-full bg-[color:var(--brand-700)] px-6 font-semibold text-white hover:bg-[color:var(--brand-900)] disabled:opacity-60">
                    Check Availability <ArrowRight aria-hidden="true" className="ml-2" size={17} />
                </button>
            </div>
            <div className="mt-7 flex items-center justify-between gap-3 lg:hidden">
                {activeMobileStep === 0 ? (
                    <Link href="/" className="inline-flex min-h-11 items-center rounded-full border border-line-soft px-4 font-semibold text-ink">Back</Link>
                ) : (
                    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center rounded-full border border-line-soft px-4 font-semibold text-ink"><ArrowLeft aria-hidden="true" className="mr-2" size={17} />Back</button>
                )}
                <button type="button" onClick={onNext} disabled={pending} className="inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white disabled:opacity-60">
                    {activeMobileStep === 5 ? 'Review & Confirm' : 'Next'} <ArrowRight aria-hidden="true" className="ml-2" size={17} />
                </button>
            </div>
        </>
    );
}

function SizeChoice({ size, selected }: { size: SizeClass; selected: boolean }) {
    const { register } = useFormContext<OrderFormInput>();
    const error = size.status === 'sold_out' || size.status === 'unavailable';

    return (
        <label className={`relative flex min-h-24 gap-3 rounded-xl border p-3 ${error ? 'cursor-not-allowed border-line-soft bg-canvas-tint opacity-70' : 'cursor-pointer border-line-soft bg-canvas has-[:checked]:border-2 has-[:checked]:border-[color:var(--brand-700)] has-[:checked]:bg-[color:var(--brand-100)] focus-within:ring-2 focus-within:ring-[color:var(--brand-700)]'}`}>
            <input type="radio" value={size.slug} disabled={error} {...register('size')} className="mt-1 accent-[color:var(--brand-700)]" />
            <span className="relative h-16 w-20 shrink-0 overflow-hidden rounded-md bg-[color:var(--brand-100)]">
                <Image src={size.image_path} alt="" fill sizes="80px" className="object-cover" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{size.label}</span>
                    <StatusPill status={size.status} />
                </span>
                <span className="mt-1 block text-sm text-ink-muted">{error ? 'Currently unavailable — ask us' : size.descriptor}</span>
                {selected && size.is_featured ? <span className="mt-1 block text-xs font-semibold text-brand-700">Most Popular</span> : null}
            </span>
        </label>
    );
}

function ReviewPanel({
    catalog,
    onBack,
    onSubmit,
    pending,
    error,
    idempotencyKey,
}: {
    catalog: Catalog | null;
    onBack: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    pending: boolean;
    error: string | null;
    idempotencyKey: string | null;
}) {
    const {
        register,
        getValues,
        formState: { errors },
    } = useFormContext<OrderFormInput>();
    const values = getValues();
    const fishLabel = fishOptions.find((option) => option.value === values.fish_type)?.label ?? 'Not selected';
    const size = catalog?.size_classes.find((item) => item.slug === values.size);
    const selectedTime = catalog?.settings.time_slots.find((slot) => slot.key === values.time_slot)?.label ?? values.time_slot;
    const summaryRows = [
        ['Fish type', fishLabel],
        ['Size range', size?.label ?? 'Not selected'],
        ['Quantity', values.quantity_kg ? `${values.quantity_kg.toLocaleString('en-NG')}kg` : 'Not selected'],
        ['Preferred date', values.preferred_date ? new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeZone: 'Africa/Lagos' }).format(new Date(`${values.preferred_date}T00:00:00+01:00`)) : 'Not selected'],
        ['Time', selectedTime || 'Not selected'],
        ['Pickup or delivery', values.fulfilment === 'delivery' ? 'Delivery' : 'Pickup'],
        ['Delivery address', values.fulfilment === 'delivery' ? values.delivery_address || 'Not provided' : 'Not applicable'],
        ['Notes', values.notes?.trim() || 'None'],
    ];

    return (
        <section aria-labelledby="review-heading" className="lg:grid lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-8">
            <div>
                <div className="mb-6">
                    <p className="text-xs font-bold uppercase tracking-[0.14em] text-brand-700">Review & Confirm</p>
                    <h2 id="review-heading" className="mt-2 font-display text-2xl font-bold text-ink">Check your request</h2>
                </div>
                <dl className="divide-y divide-line-soft border-y border-line-soft">
                    {summaryRows.map(([label, value]) => (
                        <div key={label} className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]">
                            <dt className="text-sm font-semibold text-ink-muted">{label}</dt>
                            <dd className="break-words text-sm text-ink">{value}</dd>
                        </div>
                    ))}
                </dl>

                <section className="mt-7" aria-labelledby="details-heading">
                    <h3 id="details-heading" className="font-display text-xl font-bold text-ink">Your details</h3>
                    <p className="mt-1 text-sm text-ink-muted">The farm will use these details to confirm availability and send your quote.</p>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2">
                        <div className="sm:col-span-2">
                            <label htmlFor="customer-name" className="block text-sm font-semibold text-ink">Full name</label>
                            <input id="customer-name" autoComplete="name" aria-invalid={Boolean(errors.customer_name)} aria-describedby={errors.customer_name ? 'customer-name-error' : undefined} {...register('customer_name')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="Your full name" />
                            <FieldError id="customer-name-error" message={errors.customer_name?.message} />
                        </div>
                        <div>
                            <label htmlFor="customer-phone" className="block text-sm font-semibold text-ink">WhatsApp / phone number</label>
                            <input id="customer-phone" type="tel" inputMode="tel" autoComplete="tel" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'customer-phone-error' : 'phone-hint'} {...register('phone')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="+234 801 234 5678" />
                            <p id="phone-hint" className="mt-2 text-xs text-ink-muted">Nigerian numbers accepted, including 0801… or +234…</p>
                            <FieldError id="customer-phone-error" message={errors.phone?.message} />
                        </div>
                        <div>
                            <label htmlFor="customer-email" className="block text-sm font-semibold text-ink">Email <span className="font-normal text-ink-muted">(optional)</span></label>
                            <input id="customer-email" type="email" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'customer-email-error' : undefined} {...register('email')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="you@example.com" />
                            <FieldError id="customer-email-error" message={errors.email?.message} />
                        </div>
                    </div>
                </section>

                <div className="mt-6 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-4 text-sm leading-6 text-brand-900">
                    We’ll check the farm, confirm the available size/quantity and give you the current price. <strong>You haven’t been charged.</strong>
                </div>
                {error ? <p role="alert" className="mt-5 flex items-start gap-2 border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error"><CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={18} />{error}</p> : null}
                <form onSubmit={onSubmit} className="mt-6">
                    <button type="submit" disabled={pending || !idempotencyKey} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[color:var(--brand-700)] px-6 font-semibold text-white hover:bg-[color:var(--brand-900)] disabled:cursor-wait disabled:opacity-60 sm:w-auto">
                        {pending ? <LoaderCircle aria-hidden="true" className="mr-2 animate-spin motion-reduce:animate-none" size={18} /> : null}
                        {pending ? 'Sending request…' : 'Submit Order Request'}
                    </button>
                    <p className="mt-3 max-w-xl text-xs leading-5 text-ink-muted">By submitting you agree we may contact you about this request via WhatsApp, phone or email. Read our <Link href="/privacy" className="font-semibold underline underline-offset-2">Privacy Policy</Link>.</p>
                </form>
                <button type="button" onClick={onBack} className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line-soft px-5 font-semibold text-ink"><ArrowLeft aria-hidden="true" className="mr-2" size={17} />Back to your order</button>
            </div>
            <div className="hidden lg:block">
                <AvailabilitySidebar catalog={catalog} />
            </div>
        </section>
    );
}

function SentPanel({ catalog, reference }: { catalog: Catalog | null; reference: string }) {
    const phone = catalog?.settings.phone_number;
    const whatsappDigits = catalog?.settings.whatsapp_number.replace(/\D/g, '');
    const whatsappText = `Hi, I just sent order request ${reference} and would like to follow up.`;
    const whatsappHref = whatsappDigits ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(whatsappText)}` : '/contact';

    return (
        <section className="mx-auto max-w-2xl py-8 text-center" aria-labelledby="sent-heading">
            <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--brand-100)] text-[color:var(--brand-700)]"><Check aria-hidden="true" size={30} /></span>
            <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-brand-700">Confirmation</p>
            <h2 id="sent-heading" className="mt-2 font-display text-3xl font-bold text-ink">Order Request Sent!</h2>
            <p className="mx-auto mt-4 max-w-xl leading-7 text-ink-muted">Your request has been sent to the farm. We’ll check availability and get back to you with the current price and final details.</p>
            <div className="mx-auto mt-7 max-w-sm border-y border-line-soft py-5">
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-ink-muted">Order Reference</p>
                <p className="mt-2 font-display text-2xl font-bold text-brand-900">#{reference}</p>
                <p className="mt-1 text-sm text-ink-muted">Keep this number for reference.</p>
            </div>
            <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                <Link href="/" className="inline-flex min-h-11 items-center justify-center rounded-full border border-line-soft px-5 font-semibold text-ink">Back to Home</Link>
                <a href={whatsappHref} className="inline-flex min-h-11 items-center justify-center rounded-full bg-[color:var(--whatsapp)] px-5 font-semibold text-white"><MessageCircle aria-hidden="true" className="mr-2" size={17} />Chat on WhatsApp</a>
            </div>
            {phone ? <p className="mt-7 text-sm text-ink-muted">Need urgent help? <a className="inline-flex items-center font-semibold text-[color:var(--brand-700)]" href={`tel:${phone.replace(/[^+\d]/g, '')}`}><Phone aria-hidden="true" className="mx-1" size={15} />Call the farm</a></p> : null}
        </section>
    );
}

export function OrderFlow({
    catalog,
    initialSize,
    initialIntent,
}: {
    catalog: Catalog | null;
    initialSize: string | null;
    initialIntent: string | null;
}) {
    const minOrderKg = catalog?.settings.min_order_kg ?? 40;
    const maxOrderKg = catalog?.settings.max_order_kg ?? 20_000;
    const minLeadDays = catalog?.settings.min_lead_days ?? 1;
    const timeSlotKeys = catalog?.settings.time_slots.map((slot) => slot.key) ?? ['8-10', '10-12', '12-2', '2-4', '4-6'];
    const selectableSizeSlugs = catalog?.size_classes
        .filter((size) => size.status !== 'sold_out' && size.status !== 'unavailable')
        .map((size) => size.slug);
    const [schema] = useState(() => createOrderFormSchema({
        minOrderKg,
        maxOrderKg,
        minLeadDays,
        timeSlotKeys,
        selectableSizeSlugs,
    }));
    const form = useForm<OrderFormInput, unknown, OrderFormValues>({
        resolver: zodResolver(schema),
        mode: 'onTouched',
        shouldUnregister: false,
        defaultValues: {
            fulfilment: 'pickup',
            preferred_date: defaultPreferredDate(minLeadDays),
            notes: '',
            email: '',
            delivery_address: '',
            delivery_landmark: '',
        },
    });
    const hasHydrated = useOrderDraftStore((state) => state.hasHydrated);
    const mergeDraft = useOrderDraftStore((state) => state.mergeDraft);
    const sourceIntent = useOrderDraftStore((state) => state.sourceIntent);
    const setSourceIntent = useOrderDraftStore((state) => state.setSourceIntent);
    const clearDraft = useOrderDraftStore((state) => state.clearDraft);
    const setStoredMobileStep = useOrderDraftStore((state) => state.setMobileStep);
    const setStoredReviewOpen = useOrderDraftStore((state) => state.setReviewOpen);
    const setStoredIdempotencyKey = useOrderDraftStore((state) => state.setIdempotencyKey);
    const [view, setView] = useState<'order' | 'review' | 'sent'>('order');
    const [mobileStep, setMobileStep] = useState(0);
    const [pending, setPending] = useState(false);
    const [submissionError, setSubmissionError] = useState<string | null>(null);
    const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
    const [reference, setReference] = useState<string | null>(null);
    const hydratedPresetApplied = useRef(false);

    useEffect(() => {
        void useOrderDraftStore.persist.rehydrate();
    }, []);

    useEffect(() => {
        if (!hasHydrated) return;
        const savedDraft = useOrderDraftStore.getState().draft;
        const storedProgress = useOrderDraftStore.getState();
        form.reset({
            preferred_date: defaultPreferredDate(minLeadDays),
            notes: '',
            email: '',
            delivery_address: '',
            delivery_landmark: '',
            ...savedDraft,
            fulfilment: savedDraft.fulfilment ?? 'pickup',
        });
        setMobileStep(storedProgress.mobileStep);
        if (storedProgress.reviewOpen) {
            setView('review');
            const restoredKey = storedProgress.idempotencyKey ?? crypto.randomUUID();
            setIdempotencyKey(restoredKey);
            setStoredIdempotencyKey(restoredKey);
        }
    }, [form, hasHydrated, minLeadDays, setStoredIdempotencyKey]);

    useEffect(() => {
        if (!hasHydrated) return;
        const subscription = form.watch((values) => mergeDraft(values));
        return () => subscription.unsubscribe();
    }, [form, hasHydrated, mergeDraft]);

    useEffect(() => {
        if (!hasHydrated || hydratedPresetApplied.current) return;
        hydratedPresetApplied.current = true;
        const currentDraft = useOrderDraftStore.getState().draft;
        const requestedIntent: OrderSourceIntent = initialIntent === 'bulk' || initialIntent === 'smoking' ? initialIntent : null;
        if (requestedIntent && !useOrderDraftStore.getState().sourceIntent) {
            setSourceIntent(requestedIntent);
        }
        if (initialSize && !currentDraft.size && selectableSizeSlugs?.includes(initialSize)) {
            form.setValue('size', initialSize, { shouldDirty: false });
        }
        if (requestedIntent === 'bulk' && currentDraft.quantity_kg === undefined) {
            form.setValue('quantity_kg', 500, { shouldDirty: false });
            useOrderDraftStore.getState().setQuantityPresetKg(500);
            useOrderDraftStore.getState().setTonnePlusCustom(false);
        }
        if (requestedIntent === 'smoking' && currentDraft.size === undefined) {
            const smokingSize = catalog?.size_classes.find((size) => size.is_smoking_size && selectableSizeSlugs?.includes(size.slug));
            if (smokingSize) form.setValue('size', smokingSize.slug, { shouldDirty: false });
        }
    }, [catalog, form, hasHydrated, initialIntent, initialSize, selectableSizeSlugs, setSourceIntent]);

    async function openReview() {
        for (const field of orderQuestionFields) {
            const valid = await form.trigger(field, { shouldFocus: true });
            if (!valid) return false;
            if (useOrderDraftStore.getState().tonnePlusCustom && (form.getValues('quantity_kg') ?? 0) < 1000) {
                form.setError('quantity_kg', { type: 'min', message: 'For 1 tonne+, enter at least 1000kg.' });
                form.setFocus('custom_quantity_kg');
                return false;
            }
        }
        if (form.getValues('fulfilment') === 'delivery') {
            const addressResult = deliveryAddressSchema.safeParse(form.getValues('delivery_address') ?? '');
            if (!addressResult.success) {
                form.setError('delivery_address', { type: 'manual', message: addressResult.error.issues[0]?.message });
                form.setFocus('delivery_address');
                return false;
            }
        }
        setSubmissionError(null);
        const requestKey = useOrderDraftStore.getState().idempotencyKey ?? crypto.randomUUID();
        setIdempotencyKey(requestKey);
        setStoredIdempotencyKey(requestKey);
        setStoredReviewOpen(true);
        setView('review');
        return true;
    }

    async function nextMobileStep() {
        const fields = mobileStepFields[mobileStep];
        if (!fields) return;
        const valid = await form.trigger([...fields], { shouldFocus: true });
        if (!valid) return;
        if (mobileStep === 2 && useOrderDraftStore.getState().tonnePlusCustom && (form.getValues('quantity_kg') ?? 0) < 1000) {
            form.setError('quantity_kg', { type: 'min', message: 'For 1 tonne+, enter at least 1000kg.' });
            form.setFocus('custom_quantity_kg');
            return;
        }
        if (mobileStep === 4 && form.getValues('fulfilment') === 'delivery') {
            const addressResult = deliveryAddressSchema.safeParse(form.getValues('delivery_address') ?? '');
            if (!addressResult.success) {
                form.setError('delivery_address', { type: 'manual', message: addressResult.error.issues[0]?.message });
                form.setFocus('delivery_address');
                return;
            }
        }
        if (mobileStep === mobileStepFields.length - 1) {
            await openReview();
        } else {
            const nextStep = mobileStep + 1;
            setMobileStep(nextStep);
            setStoredMobileStep(nextStep);
        }
    }

    function backMobileStep() {
        const previousStep = Math.max(0, mobileStep - 1);
        setMobileStep(previousStep);
        setStoredMobileStep(previousStep);
    }

    function returnToOrderFromReview() {
        setView('order');
        setStoredReviewOpen(false);
        setMobileStep(5);
        setStoredMobileStep(5);
    }

    async function submitOrder(values: OrderFormValues) {
        setPending(true);
        setSubmissionError(null);
        const requestKey = idempotencyKey ?? crypto.randomUUID();
        setIdempotencyKey(requestKey);
        const apiUrl = (process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');
        const requestValues = { ...values };
        delete requestValues.custom_quantity_kg;

        try {
            const response = await fetch(`${apiUrl}/api/v1/orders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': requestKey,
                },
                body: JSON.stringify({ ...requestValues, source_intent: sourceIntent }),
            });
            const responseBody: unknown = await response.json().catch(() => null);
            if (!response.ok) {
                const parsedError = errorResponseSchema.safeParse(responseBody);
                setSubmissionError(parsedError.success
                    ? parsedError.data.error.message
                    : 'We could not send your request right now. Please retry or contact the farm on WhatsApp.');
                return;
            }
            const parsedResponse = orderResponseSchema.safeParse(responseBody);
            if (!parsedResponse.success) {
                setSubmissionError('The farm received an unexpected response. Please contact them with your order details.');
                return;
            }
            setReference(parsedResponse.data.reference);
            clearDraft();
            setView('sent');
        } catch {
            setSubmissionError('We could not reach the farm right now. Your details are saved on this device; retry or send them on WhatsApp.');
        } finally {
            setPending(false);
        }
    }

    const whatsappDigits = catalog?.settings.whatsapp_number.replace(/\D/g, '');
    const currentValues = form.getValues();
    const fallbackMessage = `Hi Adesoba Farm, I would like to request ${currentValues.quantity_kg ?? ''}kg of ${currentValues.fish_type ?? 'catfish'} ${currentValues.size ?? ''}. My preferred date is ${currentValues.preferred_date ?? ''}.`;
    const fallbackHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(fallbackMessage)}`
        : '/contact';

    if (!hasHydrated) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="mt-8 min-h-40 border-y border-line-soft py-8 text-sm text-ink-muted">
                Restoring your saved order…
            </div>
        );
    }

    return (
        <FormProvider {...form}>
            <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0">
                    <div className="hidden lg:block"><Stepper activeStep={view === 'order' ? 1 : view === 'review' ? 2 : 3} /></div>
                    <DotProgress activeStep={view === 'review' || view === 'sent' ? 6 : mobileStep} />
                    {view === 'order' ? (
                        <form onSubmit={(event) => event.preventDefault()} noValidate>
                            <OrderQuestions
                                catalog={catalog}
                                activeMobileStep={mobileStep}
                                onCheckAvailability={() => { void openReview(); }}
                                onNext={() => { void nextMobileStep(); }}
                                onBack={backMobileStep}
                                pending={pending}
                            />
                        </form>
                    ) : null}
                    {view === 'review' ? (
                        <ReviewPanel
                            catalog={catalog}
                            onBack={returnToOrderFromReview}
                            onSubmit={(event) => { void form.handleSubmit(submitOrder)(event); }}
                            pending={pending}
                            error={submissionError}
                            idempotencyKey={idempotencyKey}
                        />
                    ) : null}
                    {view === 'sent' && reference ? <SentPanel catalog={catalog} reference={reference} /> : null}
                    {view === 'review' && submissionError ? (
                        <a href={fallbackHref} className="mt-4 inline-flex min-h-11 items-center rounded-full border border-[color:var(--whatsapp)] px-5 font-semibold text-[color:var(--whatsapp)]"><MessageCircle aria-hidden="true" className="mr-2" size={17} />Contact us on WhatsApp instead</a>
                    ) : null}
                </div>
                {view !== 'sent' ? <AvailabilitySidebar catalog={catalog} /> : null}
            </div>
        </FormProvider>
    );
}
