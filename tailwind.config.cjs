/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50:"#f0f7ff",100:"#dbeeff",200:"#b7ddff",300:"#86c6ff",400:"#47a5ff",500:"#1e90ff",600:"#1673d6",700:"#135caf",800:"#114e92",900:"#0f4178" }
      }
    }
  },
  plugins: []
}