// shared paper strip; the torn edges, grain and font come from .receipt in index.css
export default function Receipt({className = "", children, ...props}) {
    return (
        <div className={`receipt w-full max-w-[380px] ${className}`} {...props}>
            {children}
        </div>
    );
}
