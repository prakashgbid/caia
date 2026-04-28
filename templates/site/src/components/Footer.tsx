export function Footer() {
  const year = new Date().getFullYear();
  return (
    <footer className="border-t border-gray-200 bg-gray-50 py-8 mt-auto">
      <div className="container mx-auto px-4 text-center text-sm text-gray-500">
        <p>© {year} {{SITE_NAME}}. All rights reserved.</p>
      </div>
    </footer>
  );
}
