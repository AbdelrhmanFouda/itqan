import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Services from "@/components/Services";
import About from "@/components/About";
import Team from "@/components/Team";
import Clients from "@/components/Clients";
import Tools from "@/components/Tools";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <div className="marketing-dark">
      <Navbar />
      <main className="pt-16">
        <Hero />
        <Services />
        {/* Products section removed 2026-08-20 (owner's word): the landing page
            must not list real product names from the sheet. The component stays
            in components/Products.tsx if it is ever wanted back. */}
        <About />
        <Team />
        <Clients />
        <Tools />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
