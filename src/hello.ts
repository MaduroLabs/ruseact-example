import "./styles.css";
import { mountApplication, reportApplicationError } from "./bootstrap/mount";
import { createView } from "../.generated/examples/hello-world/App.mjs";

void mountApplication(() => createView()).catch(reportApplicationError);
