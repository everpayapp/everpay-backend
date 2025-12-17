export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center bg-gradient-to-br from-[#0a0f1f] via-[#0e1629] to-[#071018] text-white text-center p-8">
      <img
        src="/everpay-logo.svg"
        alt="EverPay Logo"
        className="w-48 h-48 mb-6 animate-pulse drop-shadow-[0_0_25px_rgba(0,255,200,0.5)]"
      />
      <h1 className="text-5xl font-extrabold bg-gradient-to-r from-[#00ffc3] to-[#00aaff] bg-clip-text text-transparent drop-shadow-[0_0_15px_rgba(0,255,200,0.4)]">
        EverPay
      </h1>
      <p className="text-gray-300 mt-3 max-w-md">
        Fast. Secure. Instant payments built for creators and businesses.
      </p>

      <a
        href="https://bibliomaniacal-aubrielle-advisedly.ngrok-free.dev/pay?amount=199"
        className="mt-10 bg-gradient-to-r from-[#00ffc3] to-[#00aaff] hover:from-[#00aaff] hover:to-[#00ffc3]
        text-[#0a0f1f] font-semibold px-8 py-4 rounded-2xl shadow-lg transition-all duration-300 transform hover:scale-105 hover:shadow-[0_0_25px_rgba(0,255,200,0.5)]"
      >
        💸 Instant Pay £1.99
      </a>

      <footer className="absolute bottom-6 text-gray-500 text-sm">
        Powered by <span className="text-[#00ffc3]">Stripe</span> • Built with 💚 by Lee
      </footer>
    </main>
  );
}
