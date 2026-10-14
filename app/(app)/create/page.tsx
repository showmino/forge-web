"use client";

import { useSearchParams } from "next/navigation";
import { CreateService } from "@/components/create-service";

// Create a service; "?template=go-grpc" picks the template.
export default function CreatePage() {
  return <CreateService initial={useSearchParams().get("template")} />;
}
