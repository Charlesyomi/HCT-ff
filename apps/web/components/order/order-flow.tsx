'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { FormProvider, useForm, useFormContext, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, ArrowRight, Check, CircleAlert, LoaderCircle, MessageCircle, Phone } from 'lucide-react';
import { z } from 'zod';
import { formatHarvestDate, formatPriceUpdatedAt, type Catalog, type SizeClass } from '@/lib/catalog-api';
import { createOrderFormSchema, defaultPreferredDate, deliveryAddressSchema, type OrderFormInput, type OrderFormValues } from '@/lib/order-form';
import { useOrderDraftStore, type OrderSourceIntent } from '@/lib/order-draft-store';
import { StatusPill } from '@/components/catalog/status-pill';
import { SignInChoice, type SignedInAccount } from '@/components/auth/sign-in-choice';
import { formatKobo } from '@/lib/money';
import { fetchTrackedOrder, readTrackedToken, rememberTrackedOrder, type TrackedOrder } from '@/lib/order-tracking';

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

const orderResponseSchema = z.object({
    reference: z.string().min(1),
    access_token: z.string().min(1),
    indicative_unit_price_kobo: z.number().int().nullable().optional(),
    indicative_total_kobo: z.number().int().nullable().optional(),
});
const errorResponseSchema = z.object({
    error: z.object({
        message: z.string(),
        fields: z.record(z.string(), z.array(z.string())).nullable().optional(),
    }),
});

const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

/** Cloudflare Turnstile invisible widget. Renders nothing when no site key is configured. */
type TurnstileStatus = 'disabled' | 'verifying' | 'verified' | 'error';

function TurnstileWidget({
    onToken,
    onStatus,
    retryCount,
}: {
    onToken: (token: string | null) => void;
    onStatus: (status: TurnstileStatus) => void;
    retryCount: number;
}) {
    const containerRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!turnstileSiteKey) {
            onStatus('disabled');
            return;
        }

        let disposed = false;
        let settled = false;
        let widgetId: string | null = null;
        let timeout: ReturnType<typeof setTimeout>;
        let script: HTMLScriptElement | null = null;
        type TurnstileApi = {
            render: (element: HTMLElement, options: Record<string, unknown>) => string;
            execute: (id: string) => void;
            remove?: (id: string) => void;
        };
        const getTurnstile = (): TurnstileApi | undefined => (window as unknown as { turnstile?: TurnstileApi }).turnstile;
        const fail = () => {
            if (disposed || settled) return;
            settled = true;
            clearTimeout(timeout);
            onToken(null);
            onStatus('error');
        };
        const startTimeout = () => {
            settled = false;
            clearTimeout(timeout);
            timeout = setTimeout(fail, 10_000);
        };
        const render = () => {
            if (disposed || settled) return;
            const turnstile = getTurnstile();
            if (!turnstile || !containerRef.current) return fail();
            try {
                widgetId = turnstile.render(containerRef.current, {
                    sitekey: turnstileSiteKey,
                    size: 'invisible',
                    appearance: 'execute',
                    callback: (token: string) => {
                        if (disposed) return;
                        settled = true;
                        clearTimeout(timeout);
                        onToken(token);
                        onStatus('verified');
                    },
                    'expired-callback': () => {
                        if (disposed) return;
                        onToken(null);
                        onStatus('verifying');
                        startTimeout();
                    },
                    'error-callback': fail,
                });
                turnstile.execute(widgetId);
            } catch {
                fail();
            }
        };

        onToken(null);
        onStatus('verifying');
        startTimeout();
        if (getTurnstile()) {
            render();
        } else {
            script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.defer = true;
            script.onload = render;
            script.onerror = fail;
            document.head.appendChild(script);
        }

        return () => {
            disposed = true;
            clearTimeout(timeout);
            if (widgetId) getTurnstile()?.remove?.(widgetId);
            script?.remove();
        };
    }, [onStatus, onToken, retryCount]);

    if (!turnstileSiteKey) return null;
    return <div ref={containerRef} aria-hidden="true" className="min-h-0" />;
}

/** Honeypot field: hidden from people, filled by naive bots (SPEC §6.12). */
function HoneypotField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
    return (
        <div aria-hidden="true" className="absolute left-[-9999px] top-[-9999px] h-0 w-0 overflow-hidden">
            <label htmlFor="website-field">Website</label>
            <input
                id="website-field"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    );
}

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

export function Stepper({ activeStep }: { activeStep: number }) {
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
                    <p className="mt-2 text-sm text-ink-muted">Next harvest: {formatHarvestDate(catalog.harvest_window.starts_on)} – {formatHarvestDate(catalog.harvest_window.ends_on)}</p>
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
    const selectedSizeDetails = sizes.find((size) => size.slug === selectedSize);
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
                {selectedSizeDetails ? (
                    selectedSizeDetails.indicative_price_per_kg_kobo != null && Number.isInteger(quantity) ? (
                        <div className="mt-5 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-3" aria-live="polite">
                            <p className="text-sm font-semibold text-brand-900">Estimated total: {formatKobo(quantity * selectedSizeDetails.indicative_price_per_kg_kobo)}</p>
                            <p className="mt-1 text-xs text-ink-muted">Estimate only. Excludes delivery. The farm confirms your final price.</p>
                        </div>
                    ) : <p className="mt-4 text-sm text-ink-muted">Price on request</p>
                ) : null}
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
                            <p className="mt-2 text-sm text-ink-muted">Our next harvest is {formatHarvestDate(harvestWindow.starts_on)}–{formatHarvestDate(harvestWindow.ends_on)}. We’ll confirm the best date with you.</p>
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
                    Review request <ArrowRight aria-hidden="true" className="ml-2" size={17} />
                </button>
            </div>
            <div className="mt-7 flex items-center justify-between gap-3 lg:hidden">
                {activeMobileStep === 0 ? (
                    <Link href="/" className="inline-flex min-h-11 items-center rounded-full border border-line-soft px-4 font-semibold text-ink">Back</Link>
                ) : (
                    <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center rounded-full border border-line-soft px-4 font-semibold text-ink"><ArrowLeft aria-hidden="true" className="mr-2" size={17} />Back</button>
                )}
                <button type="button" onClick={onNext} disabled={pending} className="inline-flex min-h-11 items-center rounded-full bg-[color:var(--brand-700)] px-5 font-semibold text-white disabled:opacity-60">
                    {activeMobileStep === 5 ? 'Review request' : 'Next'} <ArrowRight aria-hidden="true" className="ml-2" size={17} />
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
    honeypotValue,
    onHoneypotChange,
    turnstileToken,
    onTurnstileToken,
    turnstileStatus,
    turnstileRetryCount,
    onTurnstileStatus,
    onTurnstileRetry,
    fallbackHref,
    account,
    onAccountChange,
    checkoutRoute,
}: {
    catalog: Catalog | null;
    onBack: () => void;
    onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
    pending: boolean;
    error: string | null;
    idempotencyKey: string | null;
    honeypotValue: string;
    onHoneypotChange: (value: string) => void;
    turnstileToken: string | null;
    turnstileRetryCount: number;
    onTurnstileToken: (token: string | null) => void;
    turnstileStatus: TurnstileStatus;
    onTurnstileStatus: (status: TurnstileStatus) => void;
    onTurnstileRetry: () => void;
    fallbackHref: string;
    account: SignedInAccount;
    onAccountChange: (account: SignedInAccount) => void;
    checkoutRoute: boolean;
}) {
    const {
        register,
        getValues,
        formState: { errors, isSubmitted },
    } = useFormContext<OrderFormInput>();
    const [phoneCheckoutSelected, setPhoneCheckoutSelected] = useState(false);
    useEffect(() => {
        if (account) setPhoneCheckoutSelected(true);
    }, [account]);
    useEffect(() => {
        if (phoneCheckoutSelected) document.getElementById('customer-name')?.focus();
    }, [phoneCheckoutSelected]);
    const values = getValues();
    // With a Turnstile site key configured the submit button waits for a fresh token, so the
    // server always sees a single-use token; without a key (dev/tests) the check is skipped.
    const turnstileReady = !turnstileSiteKey || Boolean(turnstileToken);
    const fishLabel = fishOptions.find((option) => option.value === values.fish_type)?.label ?? 'Not selected';
    const size = catalog?.size_classes.find((item) => item.slug === values.size);
    const estimatedTotal = size?.indicative_price_per_kg_kobo != null && Number.isInteger(values.quantity_kg)
        ? values.quantity_kg * size.indicative_price_per_kg_kobo
        : null;
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
    const showDetails = !checkoutRoute || phoneCheckoutSelected || Boolean(account);

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
                <section className="mt-5 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-3" aria-label="Indicative price estimate">
                    {estimatedTotal !== null ? (
                        <>
                            <p className="font-semibold text-brand-900">Estimated total: {formatKobo(estimatedTotal)}</p>
                            <p className="mt-1 text-sm text-ink-muted">Estimate only. Excludes delivery. The farm confirms your final price.</p>
                            {size?.price_updated_at ? <p className="mt-1 text-xs text-ink-muted">Price as of {formatPriceUpdatedAt(size.price_updated_at)}</p> : null}
                        </>
                    ) : <p className="text-sm font-semibold text-ink-muted">Price on request</p>}
                </section>

                {checkoutRoute && (!phoneCheckoutSelected || account) ? (
                    <div className="mt-6">
                        <SignInChoice
                            next="/checkout"
                            account={account}
                            onAccountChange={onAccountChange}
                            showPhoneOption={!phoneCheckoutSelected}
                            onPhoneCheckout={() => setPhoneCheckoutSelected(true)}
                        />
                    </div>
                ) : null}

                {showDetails ? (
                    <>
                        <section className="mt-7" aria-labelledby="details-heading">
                            <h3 id="details-heading" className="font-display text-xl font-bold text-ink">Your details</h3>
                            <p className="mt-1 text-sm text-ink-muted">The farm will use these details to confirm availability and send your quote.</p>
                            <div className="mt-4 grid gap-4 sm:grid-cols-2">
                                <div className="sm:col-span-2">
                                    <label htmlFor="customer-name" className="block text-sm font-semibold text-ink">Full name</label>
                                    <input id="customer-name" autoComplete="name" readOnly={Boolean(account)} aria-invalid={Boolean(errors.customer_name)} aria-describedby={errors.customer_name ? 'customer-name-error' : undefined} {...register('customer_name')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="Your full name" />
                                    <FieldError id="customer-name-error" message={errors.customer_name?.message} />
                                </div>
                                <div>
                                    <label htmlFor="customer-phone" className="block text-sm font-semibold text-ink">WhatsApp / phone number</label>
                                    <input id="customer-phone" type="tel" inputMode="tel" autoComplete="tel" aria-invalid={Boolean(errors.phone)} aria-describedby={errors.phone ? 'customer-phone-error' : 'phone-hint'} {...register('phone')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="+234 801 234 5678" />
                                    <p id="phone-hint" className="mt-2 text-xs text-ink-muted">Nigerian numbers accepted, including 0801… or +234…</p>
                                    <FieldError id="customer-phone-error" message={errors.phone?.message} />
                                </div>
                                <div>
                                    <label htmlFor="customer-email" className="block text-sm font-semibold text-ink">Email {account ? <span className="font-normal text-ink-muted">(from your Google account)</span> : <span className="font-normal text-ink-muted">(optional)</span>}</label>
                                    <input id="customer-email" type="email" autoComplete="email" readOnly={Boolean(account)} aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'customer-email-error' : undefined} {...register('email')} className="mt-2 min-h-12 w-full rounded-lg border border-line-strong bg-canvas px-4 text-ink outline-none focus-visible:border-[color:var(--brand-700)] focus-visible:ring-2 focus-visible:ring-[color:var(--brand-100)]" placeholder="you@example.com" />
                                    <FieldError id="customer-email-error" message={errors.email?.message} />
                                </div>
                            </div>
                        </section>

                        <div className="mt-6 border-l-4 border-[color:var(--brand-700)] bg-[color:var(--brand-100)] px-4 py-4 text-sm leading-6 text-brand-900">
                            We’ll check the farm, confirm the available size/quantity and give you the current price. <strong>You haven’t been charged.</strong>
                        </div>
                        {error ? <p role="alert" className="mt-5 flex items-start gap-2 border border-status-error/30 bg-status-error/5 p-4 text-sm text-status-error"><CircleAlert aria-hidden="true" className="mt-0.5 shrink-0" size={18} />{error}</p> : null}
                        <form onSubmit={onSubmit} className="mt-6">
                            <HoneypotField value={honeypotValue} onChange={onHoneypotChange} />
                            <TurnstileWidget onToken={onTurnstileToken} onStatus={onTurnstileStatus} retryCount={turnstileRetryCount} />
                            <button type="submit" disabled={pending || !idempotencyKey || !turnstileReady} className="inline-flex min-h-12 w-full items-center justify-center rounded-full bg-[color:var(--brand-700)] px-6 font-semibold text-white hover:bg-[color:var(--brand-900)] disabled:cursor-wait disabled:opacity-60 sm:w-auto">
                                {pending ? <LoaderCircle aria-hidden="true" className="mr-2 animate-spin motion-reduce:animate-none" size={18} /> : null}
                                {pending ? 'Sending request…' : 'Submit Order Request'}
                            </button>
                            {pending ? <p role="status" className="mt-3 text-sm text-ink-muted">Sending your request securely…</p> : null}
                            {!pending && !idempotencyKey ? <p role="status" className="mt-3 text-sm text-ink-muted">Preparing your secure request…</p> : null}
                            {!pending && idempotencyKey && !turnstileReady && turnstileStatus !== 'error' ? <p role="status" className="mt-3 text-sm text-ink-muted">Verifying you&apos;re human…</p> : null}
                            {!turnstileReady && turnstileStatus === 'error' ? (
                                <div role="alert" className="mt-3 border-l-4 border-status-error bg-status-error/5 p-4 text-sm text-status-error">
                                    <p>We couldn&apos;t verify this request. Retry verification or send your request on WhatsApp.</p>
                                    <div className="mt-3 flex flex-wrap gap-4">
                                        <button type="button" onClick={onTurnstileRetry} className="font-semibold underline underline-offset-2">Retry verification</button>
                                        <a href={fallbackHref} className="font-semibold underline underline-offset-2">Continue on WhatsApp</a>
                                    </div>
                                </div>
                            ) : null}
                            {isSubmitted && Object.keys(errors).length > 0 ? <p role="status" className="mt-3 text-sm font-medium text-status-error">Complete the highlighted details before submitting.</p> : null}
                            <p className="mt-3 max-w-xl text-xs leading-5 text-ink-muted">By submitting you agree we may contact you about this request via WhatsApp, phone or email. Read our <Link href="/privacy" className="font-semibold underline underline-offset-2">Privacy Policy</Link>.</p>
                        </form>
                    </>
                ) : null}
                <button type="button" onClick={onBack} className="mt-5 inline-flex min-h-11 items-center rounded-full border border-line-soft px-5 font-semibold text-ink"><ArrowLeft aria-hidden="true" className="mr-2" size={17} />Back to your order</button>
            </div>
        </section>
    );
}

export function SentPanel({ catalog, reference }: { catalog: Catalog | null; reference: string }) {
    const phone = catalog?.settings.phone_number;
    const whatsappDigits = catalog?.settings.whatsapp_number.replace(/\D/g, '');
    const whatsappText = `Hi, I just sent order request ${reference} and would like to follow up.`;
    const whatsappHref = whatsappDigits ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(whatsappText)}` : '/contact';
    const [sentOrder, setSentOrder] = useState<TrackedOrder | null>(null);

    useEffect(() => {
        const token = readTrackedToken(reference);
        if (!token) return;
        let active = true;
        void fetchTrackedOrder(reference, token)
            .then((order) => { if (active) setSentOrder(order); })
            .catch(() => undefined);
        return () => { active = false; };
    }, [reference]);

    return (
        <>
            <div className="hidden lg:block"><Stepper activeStep={3} /></div>
            <section className="mx-auto max-w-2xl py-8 text-center" aria-labelledby="sent-heading">
                <span className="mx-auto inline-flex h-16 w-16 items-center justify-center rounded-full bg-[color:var(--brand-100)] text-[color:var(--brand-700)]"><Check aria-hidden="true" size={30} /></span>
                <p className="mt-5 text-xs font-bold uppercase tracking-[0.14em] text-brand-700">Confirmation</p>
                <h2 id="sent-heading" className="mt-2 font-display text-3xl font-bold text-ink">Order Request Sent!</h2>
                <p className="mx-auto mt-4 max-w-xl leading-7 text-ink-muted">Your request has been sent to the farm. We’ll check availability and get back to you with the current price and final details.</p>
                <div className="mx-auto mt-5 max-w-sm border-y border-line-soft py-4">
                    {sentOrder?.indicative_total_kobo != null ? (
                        <>
                            <p className="font-semibold text-brand-900">Estimated total: {formatKobo(sentOrder.indicative_total_kobo)}</p>
                            <p className="mt-1 text-sm text-ink-muted">Estimate only. Excludes delivery. The farm confirms your final price.</p>
                        </>
                    ) : <p className="text-sm font-semibold text-ink-muted">Price on request</p>}
                </div>
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
        </>
    );
}

function hasCheckoutDraft(draft: Partial<OrderFormInput>): boolean {
    return Boolean(
        draft.fish_type &&
        draft.size &&
        draft.quantity_kg &&
        draft.preferred_date &&
        draft.time_slot &&
        draft.fulfilment,
    );
}

export function OrderFlow({
    catalog,
    initialSize,
    initialFishType,
    initialIntent,
    mode = 'full',
}: {
    catalog: Catalog | null;
    initialSize: string | null;
    initialFishType: string | null;
    initialIntent: string | null;
    /**
     * 'full' renders the whole flow on one page (SPEC §5.2 desktop);
     * 'review' renders only Review & Confirm, used by the /checkout route (Addendum §A1),
     * which redirects to /order when the persisted draft is empty.
     */
    mode?: 'full' | 'review';
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
    const [honeypotValue, setHoneypotValue] = useState('');
    const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
    const [turnstileStatus, setTurnstileStatus] = useState<TurnstileStatus>(turnstileSiteKey ? 'verifying' : 'disabled');
    const [turnstileRetryCount, setTurnstileRetryCount] = useState(0);
    const [account, setAccount] = useState<SignedInAccount>(null);
    const [checkoutReady, setCheckoutReady] = useState(mode !== 'review');
    const router = useRouter();
    // Held in a ref so effects do not depend on the router object identity (stable in the
    // real app router, but a new object per render in some test environments).
    const routerRef = useRef(router);
    routerRef.current = router;
    const hydratedPresetApplied = useRef(false);

    useEffect(() => {
        try {
            void Promise.resolve(useOrderDraftStore.persist.rehydrate())
                .catch(() => undefined)
                .finally(() => useOrderDraftStore.getState().setHasHydrated(true));
        } catch {
            useOrderDraftStore.getState().setHasHydrated(true);
        }
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
        if (mode === 'review') {
            // /checkout shows Review & Confirm only; an empty draft means the visitor
            // arrived directly, so send them back to the form instead of a blank summary.
            if (!hasCheckoutDraft(savedDraft)) {
                routerRef.current.replace('/order');
                return;
            }
            setView('review');
            const checkoutKey = storedProgress.idempotencyKey ?? crypto.randomUUID();
            setIdempotencyKey(checkoutKey);
            setStoredIdempotencyKey(checkoutKey);
            setStoredReviewOpen(true);
            setCheckoutReady(true);
            return;
        }
        if (storedProgress.reviewOpen) {
            routerRef.current.replace('/checkout');
        }
    }, [form, hasHydrated, minLeadDays, mode, setStoredIdempotencyKey, setStoredReviewOpen]);

    useEffect(() => {
        if (!hasHydrated) return;
        const subscription = form.watch((values) => mergeDraft(values));
        return () => subscription.unsubscribe();
    }, [form, hasHydrated, mergeDraft]);

    // Addendum §A4: a Google account pre-fills and locks name/email; phone stays required
    // because the farm works by phone and WhatsApp. The draft is only overwritten for the
    // two account-owned fields, so the customer's answers to the six questions are kept.
    useEffect(() => {
        if (!account) return;
        form.setValue('customer_name', account.name ?? account.email.split('@')[0] ?? '');
        form.setValue('email', account.email);
    }, [account, form]);

    useEffect(() => {
        if (!hasHydrated || hydratedPresetApplied.current) return;
        hydratedPresetApplied.current = true;
        const currentDraft = useOrderDraftStore.getState().draft;
        const requestedIntent: OrderSourceIntent = initialIntent === 'bulk' || initialIntent === 'smoking' ? initialIntent : null;
        if (requestedIntent && !useOrderDraftStore.getState().sourceIntent) {
            setSourceIntent(requestedIntent);
        }
        if (initialFishType && !currentDraft.fish_type && fishOptions.some((option) => option.value === initialFishType)) {
            form.setValue('fish_type', initialFishType as OrderFormInput['fish_type'], { shouldDirty: false });
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
    }, [catalog, form, hasHydrated, initialFishType, initialIntent, initialSize, selectableSizeSlugs, setSourceIntent]);

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
        routerRef.current.push('/checkout');
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
        if (mode === 'review') {
            // On /checkout the form lives on another route; the draft stays persisted there.
            setStoredReviewOpen(false);
            setMobileStep(5);
            setStoredMobileStep(5);
            routerRef.current.push('/order');
            return;
        }
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
        const controller = new AbortController();
        const timeout = window.setTimeout(() => controller.abort(), 20_000);
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
                signal: controller.signal,
                body: JSON.stringify({
                    ...requestValues,
                    source_intent: sourceIntent,
                    // Honeypot and Turnstile fields (SPEC §6.12). The honeypot stays empty for
                    // humans; the Turnstile token is only present when the widget is configured.
                    website: honeypotValue,
                    turnstile_token: turnstileToken,
                }),
            });
            const responseBody: unknown = await response.json().catch(() => null);
            if (!response.ok) {
                const parsedError = errorResponseSchema.safeParse(responseBody);
                const errorMessage = parsedError.success ? parsedError.data.error.message : 'We could not send your request right now. Please retry or contact the farm on WhatsApp.';
                const fieldErrors = parsedError.success ? parsedError.data.error.fields ?? {} : {};
                const fieldEntries = Object.entries(fieldErrors);

                if (fieldEntries.length > 0) {
                    for (const [field, messages] of fieldEntries) {
                        const lastSegment = field.split('.').at(-1) ?? field;
                        const mappedField = {
                            fish_type: 'fish_type',
                            size: 'size',
                            quantity_kg: 'quantity_kg',
                            preferred_date: 'preferred_date',
                            time_slot: 'time_slot',
                            fulfilment: 'fulfilment',
                            delivery_address: 'delivery_address',
                            delivery_landmark: 'delivery_landmark',
                            notes: 'notes',
                            customer_name: 'customer_name',
                            phone: 'phone',
                            email: 'email',
                        }[lastSegment] as keyof OrderFormInput | undefined;

                        if (mappedField) {
                            form.setError(mappedField, {
                                type: 'server',
                                message: messages[0] ?? errorMessage,
                            });
                        }
                    }
                }

                if (response.status === 429) {
                    setSubmissionError('Too many attempts. Please wait a moment and try again, or contact the farm on WhatsApp.');
                    return;
                }

                if (response.status >= 500) {
                    setSubmissionError('The farm’s server is temporarily unavailable. Your details are saved; retry shortly or send your request on WhatsApp.');
                    return;
                }

                setSubmissionError(errorMessage);
                return;
            }
            const parsedResponse = orderResponseSchema.safeParse(responseBody);
            if (!parsedResponse.success) {
                setSubmissionError('The farm received an unexpected response. Please contact them with your order details.');
                return;
            }
            setReference(parsedResponse.data.reference);
            rememberTrackedOrder(parsedResponse.data.reference, parsedResponse.data.access_token);
            clearDraft();
            if (mode === 'review') {
                // Addendum §A1: confirmation lives on its own route so a refresh cannot resubmit.
                routerRef.current.push(`/order/sent/${encodeURIComponent(parsedResponse.data.reference)}`);
                return;
            }
            setView('sent');
        } catch {
            setSubmissionError(controller.signal.aborted
                ? 'The request took too long. Your details are saved on this device; retry or send them on WhatsApp.'
                : 'We could not reach the farm right now. Your details are saved on this device; retry or send them on WhatsApp.');
        } finally {
            window.clearTimeout(timeout);
            setPending(false);
        }
    }

    const whatsappDigits = catalog?.settings.whatsapp_number.replace(/\D/g, '');
    const currentValues = form.getValues();
    const fallbackMessage = `Hi Adesoba Farm, I would like to request ${currentValues.quantity_kg ?? ''}kg of ${currentValues.fish_type ?? 'catfish'} ${currentValues.size ?? ''}. My preferred date is ${currentValues.preferred_date ?? ''}.`;
    const fallbackHref = whatsappDigits
        ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent(fallbackMessage)}`
        : '/contact';

    if (!hasHydrated || (mode === 'review' && !checkoutReady)) {
        return (
            <div role="status" aria-live="polite" aria-busy="true" className="mt-8 min-h-40 border-y border-line-soft py-8 text-sm text-ink-muted">
                {mode === 'review' && hasHydrated ? 'Taking you to the order form…' : 'Restoring your saved order…'}
            </div>
        );
    }

    return (
        <FormProvider {...form}>
            <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0">
                    <div className="hidden lg:block"><Stepper activeStep={view === 'sent' ? 3 : mode === 'review' ? 2 : 1} /></div>
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
                    {view === 'review' && mode === 'review' ? (
                        <ReviewPanel
                            catalog={catalog}
                            onBack={returnToOrderFromReview}
                            onSubmit={(event) => { void form.handleSubmit(submitOrder)(event); }}
                            pending={pending}
                            error={submissionError}
                            idempotencyKey={idempotencyKey}
                            honeypotValue={honeypotValue}
                            onHoneypotChange={setHoneypotValue}
                            turnstileToken={turnstileToken}
                            turnstileRetryCount={turnstileRetryCount}
                            onTurnstileToken={setTurnstileToken}
                            turnstileStatus={turnstileStatus}
                            onTurnstileStatus={setTurnstileStatus}
                            onTurnstileRetry={() => setTurnstileRetryCount((count) => count + 1)}
                            fallbackHref={fallbackHref}
                            account={account}
                            onAccountChange={setAccount}
                            checkoutRoute={mode === 'review'}
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
