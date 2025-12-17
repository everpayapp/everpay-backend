export default {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
    "./pages/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        "everpay-blue": "#1E88E5",
        "everpay-green": "#43A047",
        "everpay-dark": "#0A0F1C"
      },
      backgroundImage: {
        "everpay-gradient": "linear-gradient(135deg, #1E88E5 0%, #43A047 100%)"
      },
      boxShadow: {
        glow: "0 0 20px rgba(30, 136, 229, 0.4)"
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"]
      }
    }
  },
  plugins: []
};
