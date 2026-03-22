class Agentboot < Formula
  desc "Convention over configuration for agentic development teams"
  homepage "https://agentboot.dev"
  url "https://registry.npmjs.org/agentboot/-/agentboot-0.2.0.tgz"
  sha256 "UPDATE_AFTER_NPM_PUBLISH"
  license "Apache-2.0"

  depends_on "node@22"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec/"bin/agentboot"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/agentboot --version")
  end
end
