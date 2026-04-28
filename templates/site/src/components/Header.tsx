export function Header() {
  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="container mx-auto px-4 h-16 flex items-center justify-between">
        <a href="/" className="text-xl font-bold">
          {{SITE_NAME}}
        </a>
        <nav aria-label="Main navigation">
          <ul className="flex gap-6 list-none m-0 p-0">
            <li><a href="/" className="text-gray-700 hover:text-black">Home</a></li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
