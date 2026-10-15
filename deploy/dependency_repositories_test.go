package deploy

import (
	"os"
	"path/filepath"
	"testing"

	"gopkg.in/yaml.v3"
)

func TestComposeForwardsDependencyRepositoryLocations(t *testing.T) {
	files, err := filepath.Glob(filepath.Join("..", "compose*.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, path := range files {
		raw, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		var compose struct {
			Services map[string]struct {
				Build struct {
					Context    string            `yaml:"context"`
					Dockerfile string            `yaml:"dockerfile"`
					Args       map[string]string `yaml:"args"`
				} `yaml:"build"`
			} `yaml:"services"`
		}
		if err := yaml.Unmarshal(raw, &compose); err != nil {
			t.Fatalf("parse %s: %v", path, err)
		}
		for name, service := range compose.Services {
			build := service.Build
			rootDockerfile := build.Dockerfile == "Dockerfile" || (build.Context == "." && build.Dockerfile == "")
			if !rootDockerfile {
				continue
			}
			checked++
			for _, tc := range []struct{ variable, repository string }{
				{"NOISE_TASKS_REPO", "tasks"},
				{"NOISE_SDLC_REPO", "sdlc"},
			} {
				want := "${" + tc.variable + ":-https://github.com/noisefloor-oss/" + tc.repository + ".git}"
				if build.Args[tc.variable] != want {
					t.Errorf("%s service %s does not forward %s with its canonical default", path, name, tc.variable)
				}
			}
		}
	}
	if checked == 0 {
		t.Fatal("no root Dockerfile build declarations found")
	}
}

func TestImageWorkflowsForwardDependencyRepositoryVariables(t *testing.T) {
	for _, name := range []string{"release-acceptance.yaml", "release-images.yaml", "public-image.yaml"} {
		raw, err := os.ReadFile(filepath.Join("..", ".github", "workflows", name))
		if name == "release-images.yaml" && os.IsNotExist(err) {
			continue // Private registry publication is omitted from the public export.
		}
		if err != nil {
			t.Fatal(err)
		}
		var workflow struct {
			Env map[string]string `yaml:"env"`
		}
		if err := yaml.Unmarshal(raw, &workflow); err != nil {
			t.Fatal(err)
		}
		for _, variable := range []string{"NOISE_TASKS_REPO", "NOISE_SDLC_REPO"} {
			if workflow.Env[variable] != "${{ vars."+variable+" }}" {
				t.Errorf("%s does not forward repository variable %s", name, variable)
			}
		}
	}
}
