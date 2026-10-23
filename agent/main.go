// snbd-agent: runs inside a VPS, dials out to the SNBD panel and serves terminal sessions.
package main

import (
	"errors"
	"log"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// version is stamped at build time: -ldflags "-X main.version=1.2.3"
var version = "dev"

func env(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func main() {
	panelURL := env("PANEL_URL", "")
	if panelURL == "" {
		log.Fatal("PANEL_URL is required, e.g. wss://panel.example.com/agent")
	}
	stateDir := env("SNBD_STATE_DIR", "/etc/snbd")
	token := os.Getenv("ENROLL_TOKEN")

	backoff := time.Second
	for {
		started := time.Now()
		err := run(panelURL, stateDir, token)
		if err != nil {
			log.Printf("disconnected: %v", err)
		}
		// a session that lasted a while resets the backoff
		if time.Since(started) > time.Minute {
			backoff = time.Second
		}
		time.Sleep(backoff)
		if backoff < 60*time.Second {
			backoff *= 2
		}
	}
}

func run(panelURL, stateDir, token string) error {
	st, _ := loadState(stateDir)
	if st == nil && token == "" {
		return errors.New("not enrolled and ENROLL_TOKEN is empty")
	}

	conn, _, err := websocket.DefaultDialer.Dial(panelURL, nil)
	if err != nil {
		return err
	}
	defer conn.Close()

	// the panel pings every 25s; if nothing at all arrives for 75s the link is dead (cable pulled,
	// NAT entry dropped), so give up and reconnect instead of waiting forever
	const idle = 75 * time.Second
	_ = conn.SetReadDeadline(time.Now().Add(idle))
	conn.SetPingHandler(func(appData string) error {
		_ = conn.SetReadDeadline(time.Now().Add(idle))
		return conn.WriteControl(websocket.PongMessage, []byte(appData), time.Now().Add(5*time.Second))
	})

	var wmu sync.Mutex
	send := func(v any) error {
		wmu.Lock()
		defer wmu.Unlock()
		_ = conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
		return conn.WriteJSON(v)
	}

	if st != nil {
		err = send(auth{Type: "auth", ServerID: st.ServerID, Key: st.Key, Version: version})
	} else {
		hostname, _ := os.Hostname()
		err = send(hello{Type: "hello", Token: token, Version: version, Hostname: hostname})
	}
	if err != nil {
		return err
	}

	terms := newTerminals()
	defer terms.closeAll()
	runs := newJobs(send)
	defer runs.killAll() // a dropped connection must not leave an installer running unseen
	done := make(chan struct{})
	defer close(done)

	for {
		var m inbound
		if err := conn.ReadJSON(&m); err != nil {
			return err
		}
		_ = conn.SetReadDeadline(time.Now().Add(idle))
		switch m.Type {
		case "enrolled":
			if err := saveState(stateDir, &state{ServerID: m.ServerID, Key: m.Key}); err != nil {
				return err
			}
			log.Printf("enrolled as server %s", m.ServerID)
			dropTokenFromEnvFile(os.Getenv("SNBD_ENV_FILE"))
		case "ready":
			log.Printf("connected to panel")
			go heartbeats(send, done)
		case "error":
			if st != nil && m.Message == "Bad credentials" {
				log.Printf("panel rejected stored key; remove %s and re-enroll with a new token", statePath(stateDir))
			}
			return errors.New("panel error: " + m.Message)
		case "term.open":
			if err := terms.open(m.Sid, clamp(m.Cols, 80), clamp(m.Rows, 24), m.Container, send); err != nil {
				log.Printf("term.open: %v", err)
				_ = send(termExit{Type: "term.exit", Sid: m.Sid})
			}
		case "term.in":
			terms.write(m.Sid, m.Data)
		case "term.resize":
			terms.resize(m.Sid, clamp(m.Cols, 80), clamp(m.Rows, 24))
		case "term.close":
			terms.remove(m.Sid)
		case "rotate":
			// the panel issued a replacement key; keep it before anything else so the next reconnect uses it
			if m.Key != "" && st != nil {
				st = &state{ServerID: st.ServerID, Key: m.Key}
				if err := saveState(stateDir, st); err != nil {
					log.Printf("could not store rotated key: %v", err)
				} else {
					log.Printf("agent key rotated")
				}
			}
		case "rpc":
			go handleRPC(m, send)
		case "job.start":
			runs.start(m.JobID, m.Script)
		case "job.cancel":
			runs.cancel(m.JobID)
		}
	}
}

func clamp(v, def int) int {
	if v <= 0 || v > 1000 {
		return def
	}
	return v
}

func heartbeats(send func(any) error, done <-chan struct{}) {
	t := time.NewTicker(10 * time.Second)
	defer t.Stop()
	for {
		if send(collect()) != nil {
			return
		}
		select {
		case <-t.C:
		case <-done:
			return
		}
	}
}
