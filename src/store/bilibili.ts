import { defineStore } from "pinia";
import { generateBilibiliWWebid } from "../api/auth";

export const useBilibiliStore = defineStore("bilibili", {
  state: () => ({
    w_webid: "",
  }),
  actions: {
    async fetchWWebid() {
      if (this.w_webid) return;
      try {
        const id = await generateBilibiliWWebid();
        this.w_webid = id;
      } catch (e: any) {
        console.error("Failed to generate w_webid:", e);
      }
    },
  },
});
