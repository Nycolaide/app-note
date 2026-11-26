import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";
import { fitToVisualViewport } from "./lib/ui/viewport";

const target = document.getElementById("app");

if (!target) {
  throw new Error("Missing #app root element");
}

fitToVisualViewport();

export default mount(App, { target });
