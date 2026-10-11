package main

import (
	"bytes"
	"context"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"testing"
	"time"
)

func TestMain(tests *testing.M) {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "--evaluator-test-cli":
			os.Args = append(os.Args[:1], os.Args[2:]...)
			main()
		case "--pilot-test-descendant":
			connection, err := net.Dial("tcp", os.Args[2])
			if err != nil {
				os.Exit(2)
			}
			_, _ = connection.Write([]byte{1})
			_, _ = io.Copy(io.Discard, connection)
			connection.Close()
			os.Exit(0)
		case "ocr-pilot":
			if os.Args[3] == "success" {
				_, _ = fmt.Fprint(os.Stdout, `{"detectedScreenType":"revenue"}`)
				os.Exit(0)
			}
			mode, address, _ := strings.Cut(os.Args[3], "|")
			if fixtureAddress := os.Getenv("EVALUATOR_TEST_CHILD_ADDRESS"); fixtureAddress != "" {
				mode, address = "wait", fixtureAddress
			}
			child := exec.Command(os.Args[0], "--pilot-test-descendant", address)
			child.Stdout = os.Stdout
			child.Stderr = os.Stderr
			if err := child.Start(); err != nil {
				os.Exit(2)
			}
			if mode == "wait" {
				_ = child.Wait()
			}
			_, _ = fmt.Fprint(os.Stdout, `{"detectedScreenType":"revenue"}`)
			os.Exit(0)
		}
	}
	os.Exit(tests.Run())
}

func TestEvaluatorSignalStopsOwnedPilotWithoutPublishingPartialReport(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("process group cleanup is supported on Linux and macOS")
	}
	t.Parallel()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, signal := range []os.Signal{os.Interrupt, syscall.SIGTERM} {
		t.Run(signal.String(), func(t *testing.T) {
			t.Parallel()
			directory := t.TempDir()
			image := filepath.Join(directory, "sample_001_20261011_test_02revenue.png")
			if err := os.WriteFile(image, nil, 0o600); err != nil {
				t.Fatal(err)
			}
			answers := "対戦No.\tプレー順\tプレーヤー名\t順位\t総資産\t収益\t" + strings.Join(incidentFields, "\t") + "\n"
			for order := 1; order <= 4; order++ {
				answers += fmt.Sprintf("1\t%d\tplayer%d\t%d\t1\t1\t0\t0\t0\t0\t0\t0\n", order, order, order)
			}
			answerPath, reportPath := filepath.Join(directory, "answers.tsv"), filepath.Join(directory, "report.json")
			if err := os.WriteFile(answerPath, []byte(answers), 0o600); err != nil {
				t.Fatal(err)
			}
			listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			_ = listener.SetDeadline(time.Now().Add(10 * time.Second))
			command := exec.Command(binary, "--evaluator-test-cli", "--samples-dir", directory,
				"--answers", answerPath, "--rust-binary", binary, "--report", reportPath, "--image-timeout", "1m")
			command.Env = append(os.Environ(), "EVALUATOR_TEST_CHILD_ADDRESS="+listener.Addr().String())
			command.WaitDelay = time.Second
			var stdout, stderr bytes.Buffer
			command.Stdout, command.Stderr = &stdout, &stderr
			if err := command.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = command.Process.Kill() })
			connection, err := listener.AcceptTCP()
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { connection.Close() })
			_ = connection.SetReadDeadline(time.Now().Add(10 * time.Second))
			var ready [1]byte
			if _, err := io.ReadFull(connection, ready[:]); err != nil {
				t.Fatal(err)
			}
			if err := command.Process.Signal(signal); err != nil {
				t.Fatal(err)
			}
			finished := make(chan error, 1)
			go func() { finished <- command.Wait() }()
			select {
			case err := <-finished:
				if err == nil || command.ProcessState.ExitCode() != 1 || !strings.Contains(stderr.String(), "evaluation interrupted") {
					t.Fatalf("interruption was not handled: err=%v stderr=%s", err, stderr.String())
				}
			case <-time.After(10 * time.Second):
				t.Fatal("interrupted evaluator did not finish")
			}
			if _, err := connection.Read(ready[:]); err != io.EOF {
				t.Fatalf("pilot descendant survived evaluator interruption: %v", err)
			}
			if stdout.Len() != 0 {
				t.Fatalf("interruption published a summary: %s", stdout.String())
			}
			if _, err := os.Stat(reportPath); !os.IsNotExist(err) {
				t.Fatalf("interruption published a partial report: %v", err)
			}
		})
	}
}

func TestRunPilotBoundsInheritedPipesAndStopsDescendants(t *testing.T) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		t.Skip("process group cleanup is supported on Linux and macOS")
	}
	t.Parallel()
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	for _, mode := range []string{"wait", "exit"} {
		t.Run(mode, func(t *testing.T) {
			t.Parallel()
			listener, err := net.ListenTCP("tcp", &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1)})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { listener.Close() })
			_ = listener.SetDeadline(time.Now().Add(10 * time.Second))
			done := make(chan error, 1)
			go func() {
				_, _, err := runPilot(context.Background(), engineOptions{binary: binary, timeout: 2 * time.Second}, imageMetadata{
					Path: mode + "|" + listener.Addr().String(), ScreenType: "revenue",
				})
				done <- err
			}()
			connection, err := listener.AcceptTCP()
			if err != nil {
				t.Fatal(err)
			}
			// Closing this connection also releases the fixture if the assertion fails.
			t.Cleanup(func() { connection.Close() })
			_ = connection.SetReadDeadline(time.Now().Add(10 * time.Second))
			var ready [1]byte
			if _, err := io.ReadFull(connection, ready[:]); err != nil {
				t.Fatalf("descendant did not become ready: %v", err)
			}
			select {
			case err := <-done:
				if err == nil {
					t.Fatal("a pilot leaving live output writers must fail")
				}
				if mode == "wait" && err.Error() != "pilot_timeout" {
					t.Fatalf("deadline failure = %v, want pilot_timeout", err)
				}
			case <-time.After(10 * time.Second):
				t.Fatal("pilot did not finish within the bounded wait")
			}
			if _, err := connection.Read(ready[:]); err != io.EOF {
				t.Fatalf("owned descendant remains alive after pilot completion: %v", err)
			}
		})
	}
}

func TestRunPilotResolvesBareBinaryFromCurrentDirectory(t *testing.T) {
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	directory := t.TempDir()
	if err := os.Symlink(binary, filepath.Join(directory, "local-pilot")); err != nil {
		t.Fatal(err)
	}
	t.Chdir(directory)
	result, _, err := runPilot(context.Background(), engineOptions{binary: "local-pilot", timeout: 5 * time.Second}, imageMetadata{
		Path: "success", ScreenType: "revenue",
	})
	if err != nil || result.DetectedScreenType != "revenue" {
		t.Fatalf("local executable failed: result=%+v err=%v", result, err)
	}
}
