import Navbar from "@/components/Navbar";
import Hero from "@/components/Hero";
import Services from "@/components/Services";
import About from "@/components/About";
import Products from "@/components/Products";
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
        <About />
        <Products />
        <Team />
        <Clients />
        <Tools />
        <Contact />
      </main>
      <Footer />
    </div>
  );
}
