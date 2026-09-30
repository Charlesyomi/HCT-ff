import { ClipboardList, Fish, Home, Phone } from 'lucide-react';

const navItems = [
    { label: 'Home', href: '/', Icon: Home },
    { label: 'Order Fish', href: '/order', Icon: Fish },
    { label: 'My Orders', href: '/my-orders', Icon: ClipboardList },
    { label: 'Contact', href: '/contact', Icon: Phone },
];

export function MobileBottomNav() {
    return (
        <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-50 border-t border-line-soft bg-canvas/95 backdrop-blur-sm md:hidden">
            <div className="mx-auto grid max-w-lg grid-cols-4 gap-2 px-2 py-2">
                {navItems.map((item) => (
                    <a
                        key={item.label}
                        href={item.href}
                        className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl px-2 py-1 text-[11px] font-medium text-ink-muted transition hover:bg-canvas-tint"
                    >
                        <item.Icon aria-hidden="true" size={18} strokeWidth={1.8} />
                        <span>{item.label}</span>
                    </a>
                ))}
            </div>
        </nav>
    );
}
