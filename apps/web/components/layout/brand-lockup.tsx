export function BrandLockup({ footer = false }: { footer?: boolean }) {
    return (
        <span className={`inline-flex flex-col leading-none ${footer ? "text-white" : "text-[color:var(--brand-900)]"}`}>
            <span className="font-display text-lg font-extrabold">HCT</span>
            <span className="mt-1 text-[9px] font-bold">FISH FARMS</span>
        </span>
    );
}