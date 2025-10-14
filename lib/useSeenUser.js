import { useEffect } from "react";
export default function useSeenUser(me){
  useEffect(() => {
    if (!me) return;
    fetch("/api/users/seen", { method: "POST" }).catch(() => {});
  }, [me]);
}
