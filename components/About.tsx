"use client";
import { useLang } from "@/context/LangContext";
import { t } from "@/lib/i18n";
import { motion, useInView, useMotionValue, useSpring } from "framer-motion";
import { useEffect, useRef } from "react";
import Image from "next/image";
import { fadeInLeft, fadeInRight } from "@/lib/animations";

function AnimatedCounter({ value, suffix = "" }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const motionVal = useMotionValue(0);
  const spring = useSpring(motionVal, { duration: 1500, bounce: 0 });
  const inView = useInView(ref, { once: true });

  useEffect(() => {
    if (inView) motionVal.set(value);
  }, [inView, motionVal, value]);

  useEffect(() => {
    return spring.on("change", (v) => {
      if (ref.current) ref.current.textContent = Math.round(v) + suffix;
    });
  }, [spring, suffix]);

  return <span ref={ref}>0{suffix}</span>;
}

export default function About() {
  const { lang } = useLang();
  const tr = t[lang];
  const isAr = lang === "ar";

  return (
    <section id="about" dir={isAr ? "rtl" : "ltr"} className="py-28 bg-gray-900 relative overflow-hidden">
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/5 to-transparent" />

      <div className="max-w-7xl mx-auto px-6">
        <div className="grid lg:grid-cols-2 gap-16 items-center">
          {/* CNC Machine Image */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={isAr ? fadeInRight : fadeInLeft}
            className="relative"
          >
            <div className="absolute -inset-4 bg-blue-500/5 rounded-3xl blur-2xl" />
            <div className="relative rounded-2xl overflow-hidden border border-white/10 shadow-2xl shadow-black/50">
              <Image
                src="/machines/cnc.jpg"
                alt="CNC Machining Center"
                width={580}
                height={400}
                className="w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-gray-950/60 via-transparent to-transparent" />
              <div className="absolute bottom-4 left-4 bg-gray-950/80 backdrop-blur rounded-xl px-4 py-2.5 border border-white/10">
                <p className="text-xs text-blue-400 font-semibold uppercase tracking-wide">
                  {isAr ? "مركز CNC" : "CNC Machining Center"}
                </p>
                <p className="text-sm text-white">{isAr ? "تصنيع القوالب داخلياً" : "In-House Mold Manufacturing"}</p>
              </div>
            </div>
          </motion.div>

          {/* Text content */}
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            variants={isAr ? fadeInLeft : fadeInRight}
          >
            <p className="text-blue-400 text-xs font-semibold uppercase tracking-widest mb-3">
              {isAr ? "من نحن" : "About Us"}
            </p>
            <h2 className="text-4xl font-bold text-white mb-6">{tr.about.title}</h2>
            <p className="text-gray-400 leading-relaxed text-lg mb-10">{tr.about.body}</p>

            {/* Animated stats */}
            <div className="grid grid-cols-2 gap-4">
              {[
                { raw: 16, suffix: "+", label: tr.about.facts[0].label },
                { raw: 100, suffix: "%", label: tr.about.facts[1].label },
                { raw: 0, suffix: "CNC", label: tr.about.facts[2].label, text: "CNC" },
                { raw: 2, suffix: "", label: tr.about.facts[3].label },
              ].map((fact, i) => (
                <div
                  key={i}
                  className="bg-gray-950 rounded-xl p-5 border border-white/5 hover:border-blue-500/20 transition-colors"
                >
                  <div className="text-3xl font-bold text-blue-400 mb-1">
                    {fact.text ? (
                      fact.text
                    ) : (
                      <AnimatedCounter value={fact.raw} suffix={fact.suffix} />
                    )}
                  </div>
                  <div className="text-sm text-gray-500">{fact.label}</div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
