import { ContactForm } from '@/components/ContactForm';

export default function HomePage() {
  return (
    <>
      <section className="container mx-auto px-4 py-16 text-center">
        <h1 className="text-4xl font-bold mb-4">Welcome to {'{{SITE_NAME}}'}</h1>
        <p className="text-lg text-gray-600">
          Replace this content with your site&apos;s home page.
        </p>
      </section>

      <section
        id="contact"
        aria-labelledby="contact-heading"
        className="bg-gray-50 border-t border-gray-200"
      >
        <div className="container mx-auto px-4 py-16 max-w-lg">
          <h2
            id="contact-heading"
            className="text-2xl font-bold text-center mb-2"
          >
            Get in Touch
          </h2>
          <p className="text-center text-gray-500 text-sm mb-8">
            Have a question or want to work together? Send us a message.
          </p>
          <ContactForm />
        </div>
      </section>
    </>
  );
}
