// Layout override para a página Report Card.
// Remove a sidebar e o wrapper ml-60 do layout pai, para que a vista seja
// standalone e optimizada para exportação/captura.

export default function ReportLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-neutral-100">
      {children}
    </div>
  );
}