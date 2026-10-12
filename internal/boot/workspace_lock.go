package boot

import (
	"context"
	"net/http"
)

func workspaceLockHandler(prepare func(context.Context) error) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if r.ContentLength != 0 || len(r.TransferEncoding) != 0 {
			http.Error(w, "workspace lock preparation refused", http.StatusBadRequest)
			return
		}
		if prepare(r.Context()) != nil {
			http.Error(w, "workspace lock preparation unconfirmed", http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
